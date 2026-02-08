/**
 * OpenAI-compatible API layer for GACUA.
 *
 * Exposes /v1/* endpoints so that an external LLM agent can drive GACUA
 * through a standard chat-completions interface (text in, text out).
 *
 * @license Apache-2.0
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

import { logger } from '../logger.js';
import { validateTokenString } from '../auth/token.js';
import { sessionManager } from '../services/session/index.js';
import { runComputerUseAgent } from '../services/computer-use/interface.js';
import type {
  ServerEvent,
  PersistentMessageContentBlock,
} from '@gacua/shared';

const apiLogger = logger.child({ module: 'openai-compat' });

// ---------------------------------------------------------------------------
// Model mapping
// ---------------------------------------------------------------------------

const MODEL_MAP: Record<string, string> = {
  'gacua-gemini-3-pro': 'gemini-3-pro-preview',
  'gacua-gemini-3-flash': 'gemini-3-flash-preview',
};

const AVAILABLE_MODELS = Object.keys(MODEL_MAP);

function resolveModel(model: string): string {
  return MODEL_MAP[model] ?? model;
}

// ---------------------------------------------------------------------------
// Auth middleware – supports both Bearer header and ?token= query param
// ---------------------------------------------------------------------------

function validateToken(req: Request, res: Response, next: NextFunction): void {
  // 1. Try Authorization: Bearer <token>
  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (validateTokenString(token)) {
      next();
      return;
    }
  }

  // 2. Fall back to query param
  const queryToken = req.query['token'] as string | undefined;
  if (queryToken && validateTokenString(queryToken)) {
    next();
    return;
  }

  apiLogger.warn(
    { method: req.method, path: req.path, ip: req.ip },
    'OpenAI API: invalid or missing token',
  );
  res.status(401).json({
    error: {
      message: 'Invalid or missing access token',
      type: 'invalid_request_error',
      code: 'invalid_api_key',
    },
  });
}

// ---------------------------------------------------------------------------
// Text extraction helpers
// ---------------------------------------------------------------------------

function extractText(blocks: PersistentMessageContentBlock[]): string {
  return blocks
    .filter(
      (b): b is { text: string } =>
        'text' in b && !('thought' in b),
    )
    .map((b) => b.text)
    .join('\n');
}

function extractActions(blocks: PersistentMessageContentBlock[]): string[] {
  const actions: string[] = [];
  for (const b of blocks) {
    if ('functionCall' in b) {
      const fc = b.functionCall;
      actions.push(formatAction(fc.name, fc.args));
    }
  }
  return actions;
}

function formatAction(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'computer_click':
      return `click on "${args['element_description'] || 'element'}"`;
    case 'computer_type':
      return `type "${args['text'] || ''}"`;
    case 'computer_key':
      return `press key [${args['key'] || ''}]`;
    case 'computer_scroll':
      return `scroll ${args['direction'] || 'down'}`;
    case 'computer_wait':
      return `wait ${args['duration'] || ''}ms`;
    case 'computer_drag_and_drop':
      return `drag and drop`;
    default:
      return `${name}(${JSON.stringify(args)})`;
  }
}

// ---------------------------------------------------------------------------
// collectAgentResponse – runs the agent and collects text + actions
// ---------------------------------------------------------------------------

interface AgentResult {
  text: string;
  finishReason: 'stop';
}

async function collectAgentResponse(
  sessionId: string,
  input: string,
  model: string | undefined,
  onStreamChunk?: (text: string) => void,
): Promise<AgentResult> {
  return new Promise<AgentResult>((resolve, reject) => {
    const textChunks: string[] = [];
    const actions: string[] = [];
    let resolved = false;

    const emitEvent = (event: ServerEvent) => {
      try {
        switch (event.type) {
          case 'stream_message': {
            const { text } = event.payload;
            if (text && event.payload.role === 'model') {
              textChunks.push(text);
              onStreamChunk?.(text);
            }
            break;
          }

          case 'persistent_message': {
            const msg = event.payload;

            // Collect model text
            if (msg.role === 'model') {
              const extracted = extractText(msg.content);
              if (extracted && textChunks.length === 0) {
                textChunks.push(extracted);
              }
              // Collect function calls (actions performed)
              actions.push(...extractActions(msg.content));
            }
            break;
          }

          case 'session_status': {
            const { status, message } = event.payload;
            if (status === 'stagnant' || status === 'error') {
              if (resolved) return;
              resolved = true;

              let finalText = textChunks.join('');

              // If model produced no meaningful text, synthesize from actions
              if (!finalText || finalText.trim().length <= 1) {
                if (status === 'error') {
                  finalText = `Error: ${message ?? 'Unknown error'}`;
                } else if (actions.length > 0) {
                  finalText =
                    'Actions performed:\n' +
                    actions.map((a, i) => `${i + 1}. ${a}`).join('\n');
                } else {
                  finalText = 'Done (no actions taken).';
                }
                // Stream the synthesized summary to SSE clients
                onStreamChunk?.(finalText);
              }

              resolve({ text: finalText, finishReason: 'stop' });
            }
            break;
          }
        }
      } catch (err) {
        apiLogger.error({ err }, 'Error processing agent event');
      }
    };

    runComputerUseAgent(sessionId, input, model, emitEvent)
      .then(() => {
        if (!resolved) {
          resolved = true;
          let finalText = textChunks.join('');
          if (!finalText || finalText.trim().length <= 1) {
            if (actions.length > 0) {
              finalText =
                'Actions performed:\n' +
                actions.map((a, i) => `${i + 1}. ${a}`).join('\n');
            } else {
              finalText = 'Done (no actions taken).';
            }
            onStreamChunk?.(finalText);
          }
          resolve({ text: finalText, finishReason: 'stop' });
        }
      })
      .catch((err) => {
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const apiRouter = Router();

// ---- GET /v1/models -------------------------------------------------------

apiRouter.get('/v1/models', validateToken, (_req, res) => {
  res.json({
    object: 'list',
    data: AVAILABLE_MODELS.map((id) => ({
      id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'gacua',
    })),
  });
});

// ---- GET /v1/sessions -----------------------------------------------------

apiRouter.get('/v1/sessions', validateToken, async (req, res) => {
  try {
    const sessions = await sessionManager.getAllSessions();
    res.json({
      object: 'list',
      data: sessions.map((s) => ({
        id: s.id,
        name: s.name,
        model: s.model,
        status: s.status,
      })),
    });
  } catch (error) {
    req.log.error({ err: error }, 'Failed to list sessions');
    res.status(500).json({ error: { message: 'Failed to list sessions' } });
  }
});

// ---- POST /v1/sessions ----------------------------------------------------

apiRouter.post('/v1/sessions', validateToken, async (req, res) => {
  try {
    const { name, model } = req.body as { name?: string; model?: string };
    const result = await sessionManager.createSession({
      name: name ?? 'api-session',
      model: resolveModel(model ?? 'gacua-gemini-3-pro'),
    });
    res.status(201).json({
      id: result.id,
      status: 'created',
    });
  } catch (error) {
    req.log.error({ err: error }, 'Failed to create session');
    res.status(500).json({ error: { message: 'Failed to create session' } });
  }
});

// ---- DELETE /v1/sessions/:id -----------------------------------------------

apiRouter.delete('/v1/sessions/:id', validateToken, async (req, res) => {
  try {
    const sessionId = req.params['id'];
    await sessionManager.deleteSession(sessionId);
    res.json({
      id: sessionId,
      object: 'session',
      deleted: true,
    });
  } catch (error) {
    const isNotFound =
      error instanceof Error &&
      ('code' in error ? (error as NodeJS.ErrnoException).code === 'ENOENT' : false);
    if (isNotFound) {
      res.status(404).json({
        error: { message: `Session '${req.params['id']}' not found`, type: 'invalid_request_error' },
      });
    } else {
      req.log.error({ err: error, sessionId: req.params['id'] }, 'Failed to delete session');
      res.status(500).json({
        error: { message: 'Failed to delete session', type: 'server_error' },
      });
    }
  }
});

// ---- GET /v1/sessions/:id/messages ----------------------------------------

apiRouter.get('/v1/sessions/:id/messages', validateToken, async (req, res) => {
  try {
    const sessionId = req.params['id'];
    const messages = await sessionManager.getMessages(sessionId);

    // Filter to user and model messages with text content only
    const filtered = messages
      .filter((m) => m.role === 'user' || m.role === 'model')
      .map((m) => ({
        role: m.role === 'model' ? 'assistant' : 'user',
        content: extractText(m.content),
      }))
      .filter((m) => m.content.length > 0);

    res.json({
      object: 'list',
      data: filtered,
    });
  } catch (error) {
    req.log.error({ err: error }, 'Failed to retrieve messages');
    res.status(500).json({ error: { message: 'Failed to retrieve messages' } });
  }
});

// ---- POST /v1/chat/completions --------------------------------------------

interface ChatCompletionRequest {
  model: string;
  session_id?: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
}

apiRouter.post('/v1/chat/completions', validateToken, async (req, res) => {
  const body = req.body as ChatCompletionRequest;
  const completionId = `chatcmpl-${randomUUID()}`;

  // Validate request
  if (!body.messages || body.messages.length === 0) {
    res.status(400).json({
      error: { message: 'messages is required and must not be empty' },
    });
    return;
  }

  const lastUserMessage = [...body.messages]
    .reverse()
    .find((m) => m.role === 'user');
  if (!lastUserMessage) {
    res.status(400).json({
      error: { message: 'At least one user message is required' },
    });
    return;
  }

  const geminiModel = resolveModel(body.model ?? 'gacua-gemini-3-pro');

  try {
    // Resolve or create session
    let sessionId = body.session_id;
    if (!sessionId) {
      const session = await sessionManager.createSession({
        name: `api-${Date.now()}`,
        model: geminiModel,
      });
      sessionId = session.id;
      apiLogger.info({ sessionId }, 'Auto-created session for chat completion');
    }

    if (body.stream) {
      // ---- Streaming (SSE) ------------------------------------------------
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Session-Id', sessionId);
      res.flushHeaders();

      // Send initial role delta
      const initialChunk = {
        id: completionId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: body.model ?? 'gacua-gemini-3-pro',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: '' },
            finish_reason: null,
          },
        ],
        session_id: sessionId,
      };
      res.write(`data: ${JSON.stringify(initialChunk)}\n\n`);

      await collectAgentResponse(
        sessionId,
        lastUserMessage.content,
        geminiModel,
        (text) => {
          const chunk = {
            id: completionId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: body.model ?? 'gacua-gemini-3-pro',
            choices: [
              {
                index: 0,
                delta: { content: text },
                finish_reason: null,
              },
            ],
            session_id: sessionId,
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        },
      );

      // Send final chunk with finish_reason
      const finalChunk = {
        id: completionId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: body.model ?? 'gacua-gemini-3-pro',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
        session_id: sessionId,
      };
      res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      // ---- Non-streaming --------------------------------------------------
      const result = await collectAgentResponse(
        sessionId,
        lastUserMessage.content,
        geminiModel,
      );

      res.json({
        id: completionId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model ?? 'gacua-gemini-3-pro',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: result.text,
            },
            finish_reason: result.finishReason,
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
        session_id: sessionId,
      });
    }
  } catch (error) {
    apiLogger.error({ err: error, completionId }, 'Chat completion failed');

    if (body.stream && res.headersSent) {
      // Already streaming – send error as SSE and close
      const errMsg =
        error instanceof Error ? error.message : 'Internal server error';
      const errorChunk = {
        id: completionId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: body.model ?? 'gacua-gemini-3-pro',
        choices: [
          {
            index: 0,
            delta: { content: `\n[Error: ${errMsg}]` },
            finish_reason: 'stop',
          },
        ],
      };
      res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.status(500).json({
        error: {
          message:
            error instanceof Error ? error.message : 'Internal server error',
          type: 'server_error',
        },
      });
    }
  }
});
