/**
 * OpenAI-compatible Content Generator adapter.
 *
 * Implements the ContentGenerator interface (Gemini format) but
 * translates requests to OpenAI API format and responses back to
 * Gemini format. This allows agent.ts to remain completely unchanged
 * while using any OpenAI-compatible backend (vLLM, HuggingFace, etc.).
 *
 * @license Apache-2.0
 */

import type {
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  CountTokensResponse,
  EmbedContentParameters,
  EmbedContentResponse,
  Content,
  FunctionDeclaration,
} from '@google/genai';
import type { ContentGenerator } from './contentGenerator.js';
import { parseOpenAIStream, openaiResponseToGemini } from './openaiStreamParser.js';

// ---------------------------------------------------------------------------
// OpenAI message types (internal)
// ---------------------------------------------------------------------------

type OpenAIMessageContent =
  | string
  | Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string; detail?: string } }
  >;

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: OpenAIMessageContent | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  temperature?: number;
  stream?: boolean;
  response_format?: { type: string; json_schema?: unknown };
  max_tokens?: number;
}

// ---------------------------------------------------------------------------
// Gemini → OpenAI translation helpers
// ---------------------------------------------------------------------------

// Helper: safely read a property from a Part (index-signature object)
function partGet(part: Record<string, unknown>, key: string): unknown {
  return part[key];
}

/**
 * Detect if an array element is a raw Part (has text/inlineData/functionCall)
 * rather than a Content object (has role + parts).
 */
function isRawPart(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  const obj = item as Record<string, unknown>;
  // Content objects have 'role' and 'parts'. Raw parts have 'text', 'inlineData', etc.
  if ('role' in obj && 'parts' in obj) return false;
  return 'text' in obj || 'inlineData' in obj || 'functionCall' in obj || 'functionResponse' in obj;
}

/**
 * Convert Gemini Content[] (or raw Part[]) to OpenAI messages[].
 * The Gemini SDK accepts both Content[] and Part[] as the `contents` parameter.
 * When raw parts are passed (e.g. grounding calls), we wrap them in a single user message.
 */
function contentsToMessages(contents: Content[] | unknown): OpenAIMessage[] {
  if (!Array.isArray(contents)) return [];

  // Handle raw Part[] (e.g. grounding calls pass [imagePart, { text: prompt }])
  if (contents.length > 0 && isRawPart(contents[0])) {
    // Wrap all raw parts into a single user Content
    contents = [{ role: 'user', parts: contents }] as Content[];
  }

  const messages: OpenAIMessage[] = [];

  for (const content of contents as Content[]) {
    const role = content.role === 'model' ? 'assistant' : 'user';
    const parts = content.parts ?? [];

    // Cast all parts to Record for bracket access (Part has index signature)
    const partsR = parts as unknown as Array<Record<string, unknown>>;

    // Check if this content has function calls (assistant with tool_calls)
    const functionCallParts = partsR.filter(
      (p) => 'functionCall' in p && partGet(p, 'functionCall'),
    );
    const functionResponseParts = partsR.filter(
      (p) => 'functionResponse' in p && partGet(p, 'functionResponse'),
    );

    if (functionCallParts.length > 0 && role === 'assistant') {
      // Assistant message with tool calls
      const textParts = partsR.filter(
        (p) => 'text' in p && !partGet(p, 'thought'),
      );
      const text = textParts
        .map((p) => partGet(p, 'text') as string)
        .join('');

      const toolCalls = functionCallParts.map((p) => {
        const fc = partGet(p, 'functionCall') as {
          id?: string;
          name: string;
          args: Record<string, unknown>;
        };
        return {
          id: fc.id ?? `call-${fc.name}-${Date.now()}`,
          type: 'function' as const,
          function: {
            name: fc.name,
            arguments: JSON.stringify(fc.args ?? {}),
          },
        };
      });

      messages.push({
        role: 'assistant',
        content: text || null,
        tool_calls: toolCalls,
      });
    } else if (functionResponseParts.length > 0) {
      // Tool response messages
      for (const p of functionResponseParts) {
        const fr = partGet(p, 'functionResponse') as {
          id?: string;
          name: string;
          response: unknown;
        };
        messages.push({
          role: 'tool',
          content: JSON.stringify(fr.response ?? {}),
          tool_call_id: fr.id ?? `call-${fr.name}`,
        });
      }
    } else {
      // Regular text/image message
      const contentParts: Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string; detail?: string } }
      > = [];

      for (const p of partsR) {
        // Skip thought parts (Gemini extended thinking)
        if (partGet(p, 'thought')) continue;

        const textVal = partGet(p, 'text');
        const inlineDataVal = partGet(p, 'inlineData');

        if (textVal && typeof textVal === 'string') {
          contentParts.push({ type: 'text', text: textVal });
        } else if (inlineDataVal) {
          const inlineData = inlineDataVal as { data: string; mimeType: string };
          contentParts.push({
            type: 'image_url',
            image_url: {
              url: `data:${inlineData.mimeType};base64,${inlineData.data}`,
              detail: 'high',
            },
          });
        }
      }

      if (contentParts.length > 0) {
        // If all parts are text, join them into a single string
        if (contentParts.every((cp) => cp.type === 'text')) {
          messages.push({
            role,
            content: contentParts
              .map((cp) => (cp as { type: 'text'; text: string }).text)
              .join('\n'),
          });
        } else {
          messages.push({ role, content: contentParts });
        }
      }
    }
  }

  return messages;
}

/**
 * Convert Gemini FunctionDeclaration[] to OpenAI tools[].
 */
function functionDeclarationsToTools(
  toolGroups: Array<{ functionDeclarations?: FunctionDeclaration[] }>,
): OpenAITool[] {
  const tools: OpenAITool[] = [];

  for (const group of toolGroups) {
    if (!group.functionDeclarations) continue;
    for (const fd of group.functionDeclarations) {
      tools.push({
        type: 'function',
        function: {
          name: fd.name ?? '',
          description: fd.description ?? '',
          parameters: (fd.parametersJsonSchema as Record<string, unknown>) ?? {
            type: 'object',
            properties: {},
          },
        },
      });
    }
  }

  return tools;
}

/**
 * Convert Gemini systemInstruction to an OpenAI system message.
 */
function systemInstructionToMessage(
  systemInstruction: unknown,
): OpenAIMessage | null {
  if (!systemInstruction) return null;

  if (typeof systemInstruction === 'string') {
    return { role: 'system', content: systemInstruction };
  }

  // systemInstruction can be a Content-like object with parts
  const si = systemInstruction as { parts?: Array<Record<string, unknown>> };
  if (si.parts) {
    const text = si.parts
      .filter((p) => 'text' in p)
      .map((p) => p['text'] as string)
      .join('\n');
    if (text) {
      return { role: 'system', content: text };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// OpenAIContentGenerator class
// ---------------------------------------------------------------------------

export class OpenAIContentGenerator implements ContentGenerator {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultModel: string;

  constructor(baseUrl: string, apiKey: string, model: string) {
    // Ensure baseUrl doesn't end with /
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.defaultModel = model;
  }

  /**
   * Build the OpenAI request body from Gemini parameters.
   */
  private buildRequest(
    request: GenerateContentParameters,
    stream: boolean,
  ): { url: string; body: OpenAIRequest } {
    const config = (request.config ?? {}) as Record<string, unknown>;
    const model = request.model || this.defaultModel;

    // Convert contents to messages
    const messages = contentsToMessages(request.contents);

    // Prepend system instruction if present
    const systemMsg = systemInstructionToMessage(config['systemInstruction']);
    if (systemMsg) {
      messages.unshift(systemMsg);
    }

    const body: OpenAIRequest = {
      model,
      messages,
      stream,
    };

    // Temperature
    const temperature = config['temperature'];
    if (typeof temperature === 'number') {
      body.temperature = temperature;
    }

    // Tools (function declarations)
    const tools = config['tools'];
    if (Array.isArray(tools) && tools.length > 0) {
      body.tools = functionDeclarationsToTools(
        tools as Array<{ functionDeclarations?: FunctionDeclaration[] }>,
      );
    }

    // Response format (JSON mode for grounding)
    if (config['responseMimeType'] === 'application/json') {
      const jsonSchema = config['responseJsonSchema'];
      if (jsonSchema) {
        body.response_format = {
          type: 'json_schema',
          json_schema: {
            name: 'response',
            schema: jsonSchema,
            strict: false,
          },
        };
      } else {
        body.response_format = { type: 'json_object' };
      }
    }

    // Max tokens — reasonable default
    if (!body.max_tokens) {
      body.max_tokens = 4096;
    }

    return {
      url: `${this.baseUrl}/chat/completions`,
      body,
    };
  }

  /**
   * Make a fetch request to the OpenAI-compatible endpoint.
   */
  private async fetchOpenAI(
    url: string,
    body: OpenAIRequest,
    abortSignal?: AbortSignal,
  ): Promise<Response> {
    // Temporary debug: log request details for grounding calls (response_format set)
    if (body.response_format) {
      console.log('[OpenAI-compat GROUNDING] messages:', JSON.stringify(body.messages.map(m => ({
        role: m.role,
        contentType: typeof m.content,
        contentLength: typeof m.content === 'string' ? m.content.length :
          Array.isArray(m.content) ? m.content.map(c => c.type) : 'null',
      }))));
      console.log('[OpenAI-compat GROUNDING] response_format:', JSON.stringify(body.response_format));
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: abortSignal,
    });

    if (!response.ok) {
      let errorMessage = `OpenAI API error: ${response.status} ${response.statusText}`;
      try {
        const errorBody = await response.text();
        errorMessage += ` — ${errorBody}`;
      } catch {
        // Ignore error reading body
      }
      throw new Error(errorMessage);
    }

    return response;
  }

  // ---- ContentGenerator interface implementation ----------------------------

  async generateContent(
    request: GenerateContentParameters,
    _userPromptId: string,
  ): Promise<GenerateContentResponse> {
    const { url, body } = this.buildRequest(request, false);
    const config = (request.config ?? {}) as Record<string, unknown>;

    const response = await this.fetchOpenAI(
      url,
      body,
      config['abortSignal'] as AbortSignal | undefined,
    );
    const json = await response.json();

    return openaiResponseToGemini(json);
  }

  async generateContentStream(
    request: GenerateContentParameters,
    _userPromptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const { url, body } = this.buildRequest(request, true);
    const config = (request.config ?? {}) as Record<string, unknown>;

    const response = await this.fetchOpenAI(
      url,
      body,
      config['abortSignal'] as AbortSignal | undefined,
    );

    return parseOpenAIStream(response);
  }

  async countTokens(
    _request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    // Not supported by OpenAI-compat endpoints — return zeros
    return { totalTokens: 0 } as CountTokensResponse;
  }

  async embedContent(
    _request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    throw new Error(
      'embedContent is not supported by OpenAI-compatible provider',
    );
  }
}
