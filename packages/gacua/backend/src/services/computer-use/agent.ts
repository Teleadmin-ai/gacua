/**
 * @license
 * Copyright 2025 MuleRun
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Config,
  type ToolCallRequestInfo,
  executeToolCall,
  type ContentGenerator,
} from '@gacua/gemini-cli-core';
import {
  type Content,
  type Part,
  GenerateContentResponse,
} from '@google/genai';
import type {
  SessionStatus,
  ToolReviewRequest,
  ToolReviewChoice,
  FunctionCall as StrictFunctionCall,
  StreamMessage,
  ToolReviewResponse,
  TurnMetrics,
  AgentMetrics,
} from '@gacua/shared';
import { takeScreenshot, cropScreenshot, imageToPart } from './screen.js';
import {
  getValidComputerTool,
  getComputerFunctionDeclarations,
} from './tool-computer/index.js';
import {
  isUITarsModel,
  parseUITarsResponse,
  uitarsActionToToolCall,
  UITARS_COMPUTER_USE_SYSTEM_PROMPT,
} from './uitars-parser.js';
import pino from 'pino';

/** Number of recent turns whose screenshot images are kept in context.
 *  Older turns' images are stripped and replaced with text placeholders.
 *  Text history is preserved — only images are stripped for older turns. */
const KEEP_RECENT_IMAGES = 3;

export type AgentInput =
  | string
  | {
      functionCall: StrictFunctionCall;
      originalFunctionCall: StrictFunctionCall;
      response: ToolReviewChoice;
    }[];

export type AgentPersistMessage = {
  role: 'user' | 'model' | 'tool' | 'workflow' | 'grounding_model';
  parts: (Part | { imageFileName: string })[];
  toolReview?: ToolReviewRequest | ToolReviewResponse;
  forDisplay?: boolean;
};

function getResponseText(
  response: GenerateContentResponse,
): { text?: string; thought?: string } | null {
  if (response.candidates && response.candidates.length > 0) {
    const candidate = response.candidates[0];
    if (
      candidate.content &&
      candidate.content.parts &&
      candidate.content.parts.length > 0
    ) {
      let mergedText = '';
      let thought = false;
      for (const part of candidate.content.parts) {
        if (part.text) {
          mergedText += part.text;
        }
        if (part.thought) {
          thought = true;
        }
      }
      return thought ? { thought: mergedText } : { text: mergedText };
    }
  }
  return null;
}

async function detectElement(
  imagePart: Part,
  elementDescription: string,
  config: Config,
  contentGenerator: ContentGenerator,
  processStreamResponse: (
    role: 'grounding_model',
    responseStream: AsyncGenerator<GenerateContentResponse>,
    forDisplay: true,
    logger: pino.Logger,
  ) => Promise<{ thought: string; output: string }>,
  logger: pino.Logger,
) {
  logger.debug({ elementDescription }, 'Starting element detection');

  const prompt = elementDescription;
  const responseStream = await contentGenerator.generateContentStream(
    {
      model: config.getModel(),
      contents: [imagePart, { text: prompt }],
      config: {
        systemInstruction: `You are a UI grounding agent.
Given an image and a text description, find the described UI element.
Return the element's bounding box as [ymin, xmin, ymax, xmax], normalized to a 0-1000 scale. Depending on the action, the center of the box may need to be on an interactable part of the element.
The box_2d should be [ymin, xmin, ymax, xmax] normalized to 0-1000.
`,
        responseMimeType: 'application/json',
        responseJsonSchema: {
          type: 'object',
          properties: {
            box_2d: {
              type: 'array',
              items: { type: 'number' },
              minItems: 4,
              maxItems: 4,
            },
            label: {
              type: 'string',
            },
          },
          required: ['box_2d'],
        },
        temperature: 0.0,
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: 256,
        },
      },
    },
    '',
  );

  const { output } = await processStreamResponse(
    'grounding_model',
    responseStream,
    true,
    logger,
  );
  if (!output) {
    logger.error(
      { elementDescription },
      'No response text from grounding model',
    );
    throw new Error('No response text');
  }

  const boundingBoxData = JSON.parse(output);
  console.log(`[GROUNDING] element="${elementDescription}" raw_output=${output}`);
  logger.info({ elementDescription, groundingOutput: output }, 'Grounding model raw output');
  const box2d = Array.isArray(boundingBoxData)
    ? boundingBoxData[0].box_2d
    : boundingBoxData.box_2d;
  console.log(`[GROUNDING] box_2d=${JSON.stringify(box2d)}`);

  if (!Array.isArray(box2d) || box2d.length !== 4) {
    logger.error(
      { elementDescription, box2d },
      'Invalid box_2d format from grounding model',
    );
    throw new Error(
      `Invalid box_2d format: expected array of 4 numbers, got ${box2d}`,
    );
  }

  // Gemini uses [ymin, xmin, ymax, xmax] convention.
  // Most other models (Qwen, OpenAI, etc.) use standard CV convention [xmin, ymin, xmax, ymax].
  // Detect by model name: if not gemini-*, swap x↔y.
  const isGeminiModel = config.getModel().startsWith('gemini');
  const coords = box2d.map((coord: unknown) => {
    const intCoord = parseInt(String(coord));
    if (isNaN(intCoord) || intCoord < 0 || intCoord > 1000) {
      logger.error({ elementDescription, coord }, 'Invalid coordinate value');
      throw new Error(`Invalid coordinate value: ${coord} (must be 0-1000)`);
    }
    return intCoord;
  });

  // Apply coordinate convention: Gemini=[ymin,xmin,ymax,xmax], others=[xmin,ymin,xmax,ymax]
  const [ymin, xmin, ymax, xmax] = isGeminiModel
    ? [coords[0], coords[1], coords[2], coords[3]]  // Gemini: already [y,x,y,x]
    : [coords[1], coords[0], coords[3], coords[2]]; // Others: swap [x,y,x,y] → [y,x,y,x]

  console.log(`[GROUNDING] model=${config.getModel()} isGemini=${isGeminiModel} raw=[${coords}] → [ymin=${ymin}, xmin=${xmin}, ymax=${ymax}, xmax=${xmax}]`);

  if (ymin >= ymax || xmin >= xmax) {
    logger.error(
      { elementDescription, ymin, xmin, ymax, xmax },
      'Invalid bounding box',
    );
    throw new Error(
      `Invalid bounding box: ymin(${ymin}) >= ymax(${ymax}) or xmin(${xmin}) >= xmax(${xmax})`,
    );
  }

  logger.debug(
    { elementDescription, boundingBox: { ymin, xmin, ymax, xmax } },
    'Element detection completed successfully',
  );
  return { ymin, xmin, ymax, xmax };
}

class ContextManager {
  private history: Content[] = [];

  constructor(initialHistory: Content[] = []) {
    this.history = this.mergeAdjacentMessages(initialHistory);
  }

  private mergeAdjacentMessages(messages: Content[]): Content[] {
    if (messages.length === 0) return [];

    const merged: Content[] = [];
    let current = messages[0];
    for (let i = 1; i < messages.length; i++) {
      const next = messages[i];
      if (next.role === current.role) {
        current.parts = [...current.parts!, ...next.parts!];
      } else {
        merged.push(current);
        current = next;
      }
    }

    merged.push(current);
    return merged;
  }

  appendContent(content: Content): ContextManager {
    if (
      this.history.length > 0 &&
      this.history[this.history.length - 1].role === content.role
    ) {
      const lastMessage = this.history[this.history.length - 1];
      lastMessage.parts = [...lastMessage.parts!, ...content.parts!];
    } else {
      this.history.push(content);
    }
    return this;
  }

  getHistory(): Content[] {
    return this.history;
  }

  /**
   * Returns the history with inlineData image parts stripped from all but
   * the last `keepRecentImages` user messages that contain images.
   * Stripped images are replaced with a single text placeholder.
   * The internal history is NOT modified — only a partial copy is returned.
   */
  getStrippedHistory(keepRecentImages: number): Content[] {
    // Find indices of user Contents that have inlineData parts
    const userIndicesWithImages: number[] = [];
    for (let i = 0; i < this.history.length; i++) {
      if (
        this.history[i].role === 'user' &&
        this.history[i].parts?.some((part) => 'inlineData' in part)
      ) {
        userIndicesWithImages.push(i);
      }
    }

    // Determine which indices to strip (all but the last N)
    const indicesToStrip = new Set(
      userIndicesWithImages.slice(
        0,
        Math.max(0, userIndicesWithImages.length - keepRecentImages),
      ),
    );

    // Nothing to strip → return original
    if (indicesToStrip.size === 0) {
      return this.history;
    }

    // Build stripped copy (only copy Content objects that need modification)
    return this.history.map((content, index) => {
      if (!indicesToStrip.has(index)) {
        return content;
      }

      // Replace inlineData parts with a single placeholder
      let imageCount = 0;
      const strippedParts: Part[] = [];
      for (const part of content.parts ?? []) {
        if ('inlineData' in part) {
          imageCount++;
        } else {
          if (imageCount > 0) {
            strippedParts.push({
              text: `[${imageCount} screenshot crop(s) removed from history]`,
            });
            imageCount = 0;
          }
          strippedParts.push(part);
        }
      }
      if (imageCount > 0) {
        strippedParts.push({
          text: `[${imageCount} screenshot crop(s) removed from history]`,
        });
      }

      return { role: content.role, parts: strippedParts };
    });
  }
}

export async function runAgent(
  config: Config,
  historyMessages: Content[],
  input: AgentInput,
  allowedTools: string[],
  setSessionStatus: (status: SessionStatus, message?: string) => Promise<void>,
  streamMessage: (message: StreamMessage) => void,
  saveImage: (imageBuffer: Buffer, nameSuffix: string) => Promise<string>,
  persistMessage: (message: AgentPersistMessage) => Promise<void>,
  logger: pino.Logger,
  emitMetrics?: (metrics: AgentMetrics) => void,
): Promise<void> {
  logger.info(
    {
      historyMessageCount: historyMessages.length,
      inputType: typeof input === 'string' ? 'text' : 'tool_responses',
      allowedToolsCount: allowedTools.length,
    },
    'Starting agent run',
  );

  const contentGenerator = config.getGeminiClient().getContentGenerator();
  const abortController = new AbortController();
  const toolRegistry = await config.getToolRegistry();
  const toolComputer = toolRegistry.getTool('.computer');
  if (!toolComputer) {
    throw new Error('Core tool .computer not found in registry');
  }

  // Detect UI-TARS mode: single-step pipeline (no grounding, no tool declarations)
  const uitarsMode = isUITarsModel(config.getModel()) || process.env['UITARS_MODE'] === 'true';
  if (uitarsMode) {
    logger.info({ model: config.getModel() }, 'UI-TARS mode enabled — single-step pipeline');
  }

  function forgeToolResponse(
    response: { output: string } | { error: string },
    functionCall: StrictFunctionCall,
    originalFunctionCall?: StrictFunctionCall,
  ): Part {
    if (!functionCall.id) {
      throw new Error('Function call id is required in tool response');
    }
    return {
      functionResponse: {
        id: originalFunctionCall?.id ?? functionCall.id,
        name: originalFunctionCall?.name ?? functionCall.name,
        response,
      },
    };
  }

  async function executeToolGetPart(
    functionCall: StrictFunctionCall,
    originalFunctionCall?: StrictFunctionCall,
  ): Promise<Part> {
    const requestInfo: ToolCallRequestInfo = {
      callId: functionCall.id,
      name: functionCall.name,
      args: functionCall.args,
      isClientInitiated: false,
      prompt_id: '',
    };

    const result = await executeToolCall(
      config,
      requestInfo,
      toolRegistry,
      abortController.signal,
    );

    const parseResult = () => {
      const parts = Array.isArray(result.responseParts)
        ? result.responseParts
        : [result.responseParts];
      return parts
        .map((part) => {
          if (typeof part === 'string') {
            return part;
          } else if (part.text) {
            return part.text;
          } else if (part.functionResponse?.response?.['output']) {
            return part.functionResponse.response['output'];
          } else {
            throw new Error('Unsupported tool response part: ' + part);
          }
        })
        .join('\n');
    };

    const response = result.error
      ? { error: result.error.message }
      : {
          output: parseResult(),
        };

    return forgeToolResponse(response, functionCall, originalFunctionCall);
  }

  let currentParts: Part[];
  if (typeof input === 'string') {
    currentParts = [{ text: input }];
    await persistMessage({
      role: 'user',
      parts: currentParts,
    });
  } else {
    currentParts = [];
    for (const { functionCall, originalFunctionCall, response } of input) {
      if (response === 'reject_once') {
        const toolRejectPart = forgeToolResponse(
          { error: 'Rejected by user' },
          functionCall,
          originalFunctionCall,
        );
        await persistMessage({
          role: 'tool',
          parts: [toolRejectPart],
          forDisplay: false,
        });
        currentParts.push(toolRejectPart);
      } else {
        // response === 'accept_once' || response === 'accept_session'
        const toolResultPart = await executeToolGetPart(
          functionCall,
          originalFunctionCall,
        );
        await persistMessage({
          role: 'tool',
          parts: [toolResultPart],
        });
        currentParts.push(toolResultPart);
      }
    }
    if (input.every(({ response }) => response === 'reject_once')) {
      setSessionStatus('stagnant', 'User rejected all tool calls.');
      return;
    }
  }

  async function processStreamResponse(
    role: 'model' | 'grounding_model',
    responseStream: AsyncGenerator<GenerateContentResponse>,
    forDisplay: boolean | undefined,
    logger: pino.Logger,
  ) {
    let thought = '';
    let output = '';
    const functionCalls: StrictFunctionCall[] = [];
    for await (const resp of responseStream) {
      logger.debug({ resp }, 'Received raw response');
      if (abortController.signal.aborted) {
        throw new Error('Operation cancelled.');
      }
      const textPart = getResponseText(resp);
      if (textPart) {
        streamMessage({ role, ...textPart });
        thought += textPart.thought || '';
        output += textPart.text || '';
      }
      // Extract function calls with thoughtSignature from parts directly
      const candidate = resp.candidates?.[0];
      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          const partAny = part as unknown as {
            functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
            thoughtSignature?: string;
          };
          if (partAny.functionCall) {
            functionCalls.push({
              id: partAny.functionCall.id ??
                `${partAny.functionCall.name}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
              name: partAny.functionCall.name!,
              args: partAny.functionCall.args!,
              thoughtSignature: partAny.thoughtSignature,
            });
          }
        }
      }
    }

    // Only persist message if there's actual content.
    if (output || functionCalls.length > 0) {
      await persistMessage({
        role,
        parts: [
          ...(thought ? [{ text: thought, thought: true }] : []),
          ...(output ? [{ text: output }] : []),
          ...functionCalls.map((fc) => ({
            functionCall: { id: fc.id, name: fc.name, args: fc.args },
            thoughtSignature: fc.thoughtSignature,
          })),
        ],
        forDisplay,
      });
    }

    return { thought, output, functionCalls };
  }

  const contextManager = new ContextManager(historyMessages);
  const agentStart = Date.now();
  const turnMetricsList: TurnMetrics[] = [];
  let turnCount = 0;
  try {
    while (true) {
      turnCount++;
      const turnStart = Date.now();
      setSessionStatus('running', 'Turn ' + turnCount);
      const turnLogger = logger.child({ turnCount });

      turnLogger.info({ turnCount, elapsed: 0 }, '=== TURN START ===');
      const screenshotStart = Date.now();
      turnLogger.debug('Taking screenshot');
      const screenshot = await takeScreenshot(
        (
          await toolComputer.buildAndExecute(
            { action: 'screenshot' },
            abortController.signal,
          )
        ).llmContent,
      );
      turnLogger.info({ phase: 'screenshot', durationMs: Date.now() - screenshotStart }, 'Screenshot taken');

      // ── UI-TARS vs standard pipeline divergence ──────────────────────
      let functionCalls: StrictFunctionCall[] = [];
      let planningMs: number;
      // For UI-TARS: we need croppedScreenshotsData for tool execution compatibility
      let croppedScreenshotsData: { imageFileName: string; imagePart: Part }[] = [];

      if (uitarsMode) {
        // ── UI-TARS SINGLE-STEP PIPELINE ───────────────────────────────
        // Send full screenshot (no crops), no tool declarations, parse text output
        const screenshotImagePart = imageToPart(screenshot);
        const screenshotFileName = await saveImage(screenshot.buffer, 'screenshot');
        const screenshotDescription = `Screenshot at ${new Date().toLocaleString()}.`;
        await persistMessage({
          role: 'workflow',
          parts: [
            { text: screenshotDescription },
            { imageFileName: screenshotFileName },
          ],
          forDisplay: true,
        });
        currentParts.push(
          { text: screenshotDescription },
          screenshotImagePart,
        );

        const planStart = Date.now();
        turnLogger.info('UI-TARS: planning next step (single-step)');

        contextManager.appendContent({ role: 'user', parts: currentParts });
        const requestContents = contextManager.getStrippedHistory(KEEP_RECENT_IMAGES);

        const responseStream = await contentGenerator.generateContentStream(
          {
            model: config.getModel(),
            contents: requestContents,
            config: {
              abortSignal: abortController.signal,
              // No tools — UI-TARS outputs text actions
              systemInstruction: UITARS_COMPUTER_USE_SYSTEM_PROMPT,
              temperature: 0.2,
            },
          },
          '',
        );

        const result = await processStreamResponse(
          'model',
          responseStream,
          undefined,
          turnLogger,
        );

        planningMs = Date.now() - planStart;
        const fullText = (result.thought ? result.thought + '\n' : '') + (result.output || '');
        turnLogger.info({ phase: 'planning', durationMs: planningMs, text: fullText.slice(0, 200) }, 'UI-TARS planning completed');

        // Parse UI-TARS text output
        const parsed = parseUITarsResponse(fullText);
        turnLogger.info({ thought: parsed.thought, action: parsed.action }, 'UI-TARS parsed response');

        contextManager.appendContent({
          role: 'model',
          parts: [{ text: fullText }],
        });

        if (parsed.action) {
          if (parsed.action.type === 'finished') {
            // Task complete
            const summary = parsed.action.content || parsed.thought || 'Task completed';
            const totalMs = Date.now() - turnStart;
            turnLogger.info({ summary, turnDurationMs: totalMs }, 'UI-TARS signaled task completion');
            turnMetricsList.push({
              turn: turnCount,
              screenshotMs: Date.now() - turnStart - planningMs,
              planningMs,
              executionMs: 0,
              totalMs,
              actions: ['finished'],
            });
            setSessionStatus('stagnant', summary);
            break;
          }

          if (parsed.action.type === 'call_user') {
            const totalMs = Date.now() - turnStart;
            turnMetricsList.push({
              turn: turnCount,
              screenshotMs: Date.now() - turnStart - planningMs,
              planningMs,
              executionMs: 0,
              totalMs,
              actions: ['call_user'],
            });
            setSessionStatus('stagnant', 'Model requested human help: ' + parsed.thought);
            break;
          }

          // Convert UI-TARS action to GACUA tool call (coordinates already resolved)
          const toolCall = uitarsActionToToolCall(
            parsed.action,
            screenshot.resolution.width,
            screenshot.resolution.height,
          );

          if (toolCall) {
            const execStart = Date.now();
            const actionId = `uitars-${turnCount}-${Date.now()}`;
            const requestInfo: ToolCallRequestInfo = {
              callId: actionId,
              name: toolCall.name,
              args: toolCall.args,
              isClientInitiated: false,
              prompt_id: '',
            };

            turnLogger.info({ toolCall, actionId }, 'UI-TARS executing tool call directly');

            const toolResult = await executeToolCall(
              config,
              requestInfo,
              toolRegistry,
              abortController.signal,
            );

            const executionMs = Date.now() - execStart;
            const totalMs = Date.now() - turnStart;

            // Build tool response for context
            const responseText = toolResult.error
              ? `Error: ${toolResult.error.message}`
              : 'Action executed successfully.';

            await persistMessage({
              role: 'tool',
              parts: [{ text: responseText }],
            });
            contextManager.appendContent({
              role: 'user',
              parts: [{ text: responseText }],
            });

            const actionDesc = `${parsed.action.type}(${parsed.action.startBox ? `${parsed.action.startBox.x},${parsed.action.startBox.y}` : parsed.action.content || parsed.action.key || ''})`;
            turnMetricsList.push({
              turn: turnCount,
              screenshotMs: planStart - turnStart,
              planningMs,
              executionMs,
              totalMs,
              actions: [actionDesc],
            });

            turnLogger.info({
              phase: 'execution',
              durationMs: executionMs,
              turnDurationMs: totalMs,
              action: actionDesc,
            }, 'UI-TARS tool execution completed');

            currentParts = [{ text: responseText }];
          } else {
            turnLogger.warn({ action: parsed.action }, 'UI-TARS action could not be converted to tool call');
            currentParts = [{ text: 'Action not recognized, please try again.' }];
          }
        } else {
          // No action parsed — model only produced thought
          turnLogger.warn({ text: fullText.slice(0, 200) }, 'UI-TARS produced no action');
          const totalMs = Date.now() - turnStart;
          turnMetricsList.push({
            turn: turnCount,
            screenshotMs: planStart - turnStart,
            planningMs,
            executionMs: 0,
            totalMs,
            actions: [],
          });
          setSessionStatus('stagnant', 'Model produced no action.');
          break;
        }

        // Continue to next turn (UI-TARS loop)
        continue;
      }

      // ── STANDARD TWO-STEP PIPELINE (Gemini / Qwen3-VL) ──────────────
      turnLogger.debug('Cropping screenshot');
      const croppedScreenshots = await cropScreenshot(screenshot);
      croppedScreenshotsData = await Promise.all(
        croppedScreenshots.map(
          async ({ image, nameSuffix }) => ({
            imageFileName: await saveImage(image.buffer, nameSuffix),
            imagePart: imageToPart(image),
          }),
        ),
      );
      const screenshotDescription = `Screenshot at ${new Date().toLocaleString()}. The screen is split into ${croppedScreenshotsData.length} cropped images with valid image_id values from 0 to ${croppedScreenshotsData.length - 1}:`;
      await persistMessage({
        role: 'workflow',
        parts: [
          { text: screenshotDescription },
          { imageFileName: await saveImage(screenshot.buffer, 'screenshot') },
        ],
        forDisplay: true,
      });
      await persistMessage({
        role: 'workflow',
        parts: [
          { text: screenshotDescription },
          ...croppedScreenshotsData.map(({ imageFileName }) => ({
            imageFileName,
          })),
        ],
        forDisplay: false,
      });
      currentParts.push(
        { text: screenshotDescription },
        ...croppedScreenshotsData.map(({ imagePart }) => imagePart),
        { text: 'IMPORTANT: When you have completed the user\'s task, you MUST call computer_done with a summary instead of performing more actions.' },
      );

      const planStart = Date.now();
      turnLogger.info('Planning next step');

      async function planNextStep(extraPrompt?: string): Promise<boolean> {
        const userParts = currentParts;
        if (extraPrompt) {
          userParts.push({ text: extraPrompt });
        }

        contextManager.appendContent({
          role: 'user',
          parts: userParts,
        });
        const requestContents = contextManager.getStrippedHistory(KEEP_RECENT_IMAGES);

        // Log image stripping activity
        const fullImageCount = contextManager.getHistory()
          .reduce((n, c) => n + (c.parts?.filter((p) => 'inlineData' in p).length ?? 0), 0);
        const sentImageCount = requestContents
          .reduce((n, c) => n + (c.parts?.filter((p) => 'inlineData' in p).length ?? 0), 0);
        if (fullImageCount !== sentImageCount) {
          turnLogger.info(
            { fullImageCount, sentImageCount, stripped: fullImageCount - sentImageCount },
            'Stripped old screenshot images from context',
          );
        }

        const responseStream = await contentGenerator.generateContentStream(
          {
            model: config.getModel(),
            contents: requestContents,
            config: {
              abortSignal: abortController.signal,
              tools: [
                { functionDeclarations: getComputerFunctionDeclarations() },
              ],
              temperature: 0.2,
              thinkingConfig: {
                includeThoughts: true,
              },
            },
          },
          '',
        );

        const result = await processStreamResponse(
          'model',
          responseStream,
          undefined,
          turnLogger,
        );

        if (result.output || result.functionCalls.length > 0) {
          contextManager.appendContent({
            role: 'model',
            parts: [
              ...(result.output ? [{ text: result.output }] : []),
              ...result.functionCalls.map((fc) => ({
                functionCall: { id: fc.id, name: fc.name, args: fc.args },
                thoughtSignature: fc.thoughtSignature,
              })),
            ],
          });
          functionCalls = result.functionCalls;
          return true;
        }

        return false;
      }

      if (!(await planNextStep())) {
        turnLogger.warn('Empty response from model, retrying with "continue"');
        if (!(await planNextStep('continue'))) {
          setSessionStatus(
            'error',
            'Model returned empty response even after retry.',
          );
        }
      }

      planningMs = Date.now() - planStart;
      turnLogger.info({
        phase: 'planning',
        durationMs: planningMs,
        functionCallCount: functionCalls.length,
        functionCallNames: functionCalls.map((fc) => fc.name),
      }, 'Planning completed');

      if (functionCalls.length > 0) {
        // Check if the model called computer_done — task is complete
        const doneFc = functionCalls.find((fc) => fc.name === 'computer_done');
        if (doneFc) {
          const summary = (doneFc.args as { summary?: string })?.summary || 'Task completed';
          const totalMs = Date.now() - turnStart;
          turnLogger.info({ summary, turnDurationMs: totalMs }, 'Model signaled task completion via computer_done');
          turnMetricsList.push({
            turn: turnCount,
            screenshotMs: Date.now() - turnStart - planningMs, // approximate
            planningMs,
            executionMs: 0,
            totalMs,
            actions: ['computer_done'],
          });
          setSessionStatus('stagnant', summary);
          break;
        }

        const execStart = Date.now();
        turnLogger.debug(
          { functionCallCount: functionCalls.length },
          'Processing function calls',
        );

        const toolResponseParts: Part[] = [];
        let pending = false;
        const toolReviewMessages: AgentPersistMessage[] = [];
        // If any function call needs review, all others will be delayed.
        const delayedFunctionCalls: {
          functionCall: StrictFunctionCall;
          originalFunctionCall: StrictFunctionCall;
        }[] = [];

        for (const fc of functionCalls) {
          const originalFunctionCall: StrictFunctionCall = {
            id: fc.id ?? `${fc.name}-${Date.now()}`,
            name: fc.name!,
            args: fc.args!,
            thoughtSignature: fc.thoughtSignature,
          };
          const id = originalFunctionCall.id;
          const functionCallLogger = turnLogger.child({ id });
          functionCallLogger.info(
            { originalFunctionCall },
            'Processing function call',
          );

          let functionCall = originalFunctionCall;
          if (functionCall.name.startsWith('computer_')) {
            functionCallLogger.debug('Processing computer tool call');

            const groundableTool = getValidComputerTool(
              originalFunctionCall.name,
              originalFunctionCall.args,
            );
            if (typeof groundableTool === 'string') {
              functionCallLogger.warn(
                {
                  groundingError: groundableTool,
                },
                'Validation failed',
              );
              toolResponseParts.push(
                forgeToolResponse(
                  { error: groundableTool },
                  functionCall,
                  originalFunctionCall,
                ),
              );
              continue;
            }

            const groundedToolCall = await groundableTool.ground(
              originalFunctionCall.args,
              screenshot,
              croppedScreenshotsData,
              (imagePart: Part, elementDescription: string) =>
                detectElement(
                  imagePart,
                  elementDescription,
                  config,
                  contentGenerator,
                  processStreamResponse,
                  functionCallLogger,
                ),
            );
            if (typeof groundedToolCall === 'string') {
              functionCallLogger.warn(
                {
                  groundingError: groundedToolCall,
                },
                'Grounding process failed',
              );
              toolResponseParts.push(
                forgeToolResponse(
                  {
                    error: 'Error during grounding: ' + groundedToolCall,
                  },
                  functionCall,
                  originalFunctionCall,
                ),
              );
              continue;
            }

            functionCall = {
              ...groundedToolCall.value(),
              id: originalFunctionCall.id,
              thoughtSignature: originalFunctionCall.thoughtSignature,
            };
            const toolCallDescription =
              await groundedToolCall.getDescription(saveImage);
            toolReviewMessages.push({
              role: 'workflow',
              parts: toolCallDescription,
              toolReview: {
                reviewId: id,
                functionCall,
                originalFunctionCall,
              },
              forDisplay: true,
            });

            if (allowedTools.includes(originalFunctionCall.name)) {
              functionCallLogger.info('Tool auto-accepted, executing directly');
              toolReviewMessages.push({
                role: 'user',
                parts: [],
                toolReview: {
                  reviewId: id,
                  choice: 'accept_session',
                },
                forDisplay: true,
              });
              delayedFunctionCalls.push({ functionCall, originalFunctionCall });
            } else {
              pending = true;
            }

            // Computer function calls are either pending or delayed.
            continue;
          }

          // Non-computer function calls, we do not care their execution order.
          toolResponseParts.push(
            await executeToolGetPart(functionCall, originalFunctionCall),
          );
        }

        // 1. Display executed tool call responses if any.
        if (toolResponseParts.length > 0) {
          await persistMessage({
            role: 'tool',
            parts: toolResponseParts,
          });
        }

        // 2. Display tool call reviews if any.
        for (const message of toolReviewMessages) {
          await persistMessage(message);
        }

        // 3. If not pending, execute and display delayed function calls if any.
        if (!pending) {
          const delayedToolResponseParts = [];
          for await (const part of delayedFunctionCalls.map(
            async ({ functionCall, originalFunctionCall }) =>
              await executeToolGetPart(functionCall, originalFunctionCall),
          )) {
            delayedToolResponseParts.push(part);
          }
          persistMessage({
            role: 'tool',
            parts: delayedToolResponseParts,
          });
          toolResponseParts.push(...delayedToolResponseParts);
        }

        const executionMs = Date.now() - execStart;
        const totalMs = Date.now() - turnStart;
        turnLogger.info({
          phase: 'execution',
          durationMs: executionMs,
          turnDurationMs: totalMs,
        }, 'Tool execution completed');

        const turnActions = functionCalls
          .filter((fc) => fc.name !== 'computer_done')
          .map((fc) => `${fc.name}(${JSON.stringify(fc.args)})`);
        turnMetricsList.push({
          turn: turnCount,
          screenshotMs: planStart - turnStart,
          planningMs,
          executionMs,
          totalMs,
          actions: turnActions,
        });

        if (pending) {
          turnLogger.info('Session paused for tool review');
          setSessionStatus('pending', 'Tool call pending.');
          break;
        }

        currentParts = toolResponseParts;
      } else {
        const totalMs = Date.now() - turnStart;
        const message = 'No more tool calls from model.';
        turnLogger.info({ turnDurationMs: totalMs }, message);
        turnMetricsList.push({
          turn: turnCount,
          screenshotMs: planStart - turnStart,
          planningMs,
          executionMs: 0,
          totalMs,
          actions: [],
        });
        setSessionStatus('stagnant', message);
        break;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ turnCount, error, message }, 'Agent execution failed');
    setSessionStatus('error', message);
  } finally {
    const agentMetrics: AgentMetrics = {
      turns: turnMetricsList,
      totalMs: Date.now() - agentStart,
    };
    logger.info({ turnCount, totalMs: agentMetrics.totalMs }, 'Agent run completed');
    emitMetrics?.(agentMetrics);
  }
}
