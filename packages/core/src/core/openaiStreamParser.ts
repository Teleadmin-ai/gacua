/**
 * OpenAI SSE streaming parser.
 *
 * Parses Server-Sent Events from an OpenAI-compatible streaming response
 * and yields GenerateContentResponse objects in Gemini format.
 *
 * @license Apache-2.0
 */

import type { GenerateContentResponse } from '@google/genai';

// ---------------------------------------------------------------------------
// Internal types matching OpenAI streaming format
// ---------------------------------------------------------------------------

interface OpenAIToolCallDelta {
  index: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string | null;
      tool_calls?: OpenAIToolCallDelta[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

// ---------------------------------------------------------------------------
// Accumulated tool call state
// ---------------------------------------------------------------------------

interface AccumulatedToolCall {
  id: string;
  name: string;
  argumentChunks: string[];
}

// ---------------------------------------------------------------------------
// Helper: build a GenerateContentResponse from text or function calls
// ---------------------------------------------------------------------------

function buildGeminiResponse(
  text?: string,
  functionCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>,
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number },
): GenerateContentResponse {
  const parts: Record<string, unknown>[] = [];

  if (text) {
    parts.push({ text });
  }

  if (functionCalls) {
    for (const fc of functionCalls) {
      parts.push({
        functionCall: { id: fc.id, name: fc.name, args: fc.args },
      });
    }
  }

  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts,
        },
      },
    ],
    ...(usageMetadata && { usageMetadata }),
  } as unknown as GenerateContentResponse;
}

// ---------------------------------------------------------------------------
// Main parser: async generator that reads a fetch Response body
// ---------------------------------------------------------------------------

/**
 * Parse an OpenAI SSE streaming response and yield GenerateContentResponse
 * objects compatible with the Gemini interface.
 *
 * Handles:
 * - Text content deltas → emitted as individual responses
 * - Tool call deltas → accumulated and emitted once complete
 * - `data: [DONE]` → stops iteration
 */
export async function* parseOpenAIStream(
  response: Response,
): AsyncGenerator<GenerateContentResponse> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('OpenAI stream: response body is not readable');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  const toolCalls = new Map<number, AccumulatedToolCall>();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines
      const lines = buffer.split('\n');
      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();

        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith(':')) continue;

        // Must start with "data: "
        if (!trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);

        // End-of-stream signal
        if (data === '[DONE]') {
          // Emit any remaining accumulated tool calls
          if (toolCalls.size > 0) {
            const fcs = emitToolCalls(toolCalls);
            if (fcs.length > 0) {
              yield buildGeminiResponse(undefined, fcs);
            }
            toolCalls.clear();
          }
          return;
        }

        let chunk: OpenAIStreamChunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          // Skip malformed JSON
          continue;
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;

        // Text content
        if (delta.content) {
          yield buildGeminiResponse(delta.content);
        }

        // Tool call deltas
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            let acc = toolCalls.get(tc.index);
            if (!acc) {
              acc = {
                id: tc.id ?? `tool-${tc.index}-${Date.now()}`,
                name: '',
                argumentChunks: [],
              };
              toolCalls.set(tc.index, acc);
            }
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) {
              if (acc.name && acc.name !== tc.function.name) {
                // Different tool name on same index — model sent multiple tool
                // calls reusing the same streaming index (Qwen3-VL quirk).
                // Create a separate entry with a synthetic index.
                const syntheticIndex = tc.index + 1000 + toolCalls.size;
                acc = {
                  id: tc.id ?? `tool-${syntheticIndex}-${Date.now()}`,
                  name: tc.function.name,
                  argumentChunks: [],
                };
                toolCalls.set(syntheticIndex, acc);
              } else {
                acc.name = tc.function.name;
              }
            }
            if (tc.function?.arguments) acc.argumentChunks.push(tc.function.arguments);
          }
        }

        // When finish_reason is set, emit accumulated tool calls
        if (choice.finish_reason) {
          if (toolCalls.size > 0) {
            const fcs = emitToolCalls(toolCalls);
            if (fcs.length > 0) {
              yield buildGeminiResponse(undefined, fcs, chunk.usage ? {
                promptTokenCount: chunk.usage.prompt_tokens,
                candidatesTokenCount: chunk.usage.completion_tokens,
                totalTokenCount: chunk.usage.total_tokens,
              } : undefined);
            }
            toolCalls.clear();
          }
        }
      }
    }

    // Handle any remaining data in buffer
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith('data: ') && trimmed.slice(6) !== '[DONE]') {
        try {
          const chunk: OpenAIStreamChunk = JSON.parse(trimmed.slice(6));
          const choice = chunk.choices?.[0];
          if (choice?.delta?.content) {
            yield buildGeminiResponse(choice.delta.content);
          }
        } catch {
          // Ignore malformed trailing data
        }
      }
    }

    // Emit any remaining tool calls
    if (toolCalls.size > 0) {
      const fcs = emitToolCalls(toolCalls);
      if (fcs.length > 0) {
        yield buildGeminiResponse(undefined, fcs);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Helper: convert accumulated tool calls to function call format
// ---------------------------------------------------------------------------

function emitToolCalls(
  toolCalls: Map<number, AccumulatedToolCall>,
): Array<{ id: string; name: string; args: Record<string, unknown> }> {
  const result: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];

  for (const [, tc] of [...toolCalls.entries()].sort(([a], [b]) => a - b)) {
    if (!tc.name) continue;
    const argsStr = tc.argumentChunks.join('');
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(argsStr);
    } catch {
      // If argument parsing fails, pass raw string
      args = { _raw: argsStr };
    }
    result.push({ id: tc.id, name: tc.name, args });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Non-streaming helper: parse a complete OpenAI response
// ---------------------------------------------------------------------------

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Convert a non-streaming OpenAI response to GenerateContentResponse.
 */
export function openaiResponseToGemini(
  response: OpenAIResponse,
): GenerateContentResponse {
  const choice = response.choices?.[0];
  if (!choice) {
    return buildGeminiResponse('No response from model');
  }

  const functionCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];

  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = { _raw: tc.function.arguments };
      }
      functionCalls.push({
        id: tc.id,
        name: tc.function.name,
        args,
      });
    }
  }

  return buildGeminiResponse(
    choice.message.content ?? undefined,
    functionCalls.length > 0 ? functionCalls : undefined,
    response.usage ? {
      promptTokenCount: response.usage.prompt_tokens,
      candidatesTokenCount: response.usage.completion_tokens,
      totalTokenCount: response.usage.total_tokens,
    } : undefined,
  );
}
