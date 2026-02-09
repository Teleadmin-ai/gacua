/**
 * UI-TARS text action parser.
 *
 * Converts UI-TARS ReAct-style text output into structured actions
 * that can be executed by GACUA's tool pipeline.
 *
 * UI-TARS format:
 *   Thought: I need to click the Save button
 *   Action: click(start_box='(197,525)')
 *
 * Coordinates are normalized 0-1000. Conversion to pixels:
 *   X_pixel = round(screenWidth * X / 1000)
 *   Y_pixel = round(screenHeight * Y / 1000)
 *
 * @license Apache-2.0
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UITarsActionType =
  | 'click'
  | 'left_double'
  | 'right_single'
  | 'drag'
  | 'hotkey'
  | 'type'
  | 'scroll'
  | 'wait'
  | 'finished'
  | 'call_user';

export interface UITarsAction {
  type: UITarsActionType;
  startBox?: { x: number; y: number }; // normalized 0-1000
  endBox?: { x: number; y: number }; // for drag
  content?: string; // for type, finished
  key?: string; // for hotkey (space-separated keys)
  direction?: 'up' | 'down' | 'left' | 'right'; // for scroll
}

export interface UITarsParsedResponse {
  thought: string;
  action: UITarsAction | null;
  raw: string;
}

// ---------------------------------------------------------------------------
// Coordinate parser
// ---------------------------------------------------------------------------

/**
 * Parse a box string like "(197,525)" into {x, y}.
 * Handles optional whitespace and the <|box_start|>/<|box_end|> tokens.
 */
function parseBox(boxStr: string): { x: number; y: number } | null {
  // Strip special tokens
  const cleaned = boxStr
    .replace(/<\|box_start\|>/g, '')
    .replace(/<\|box_end\|>/g, '')
    .trim();
  const match = cleaned.match(/\(\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (!match) return null;
  return { x: parseInt(match[1], 10), y: parseInt(match[2], 10) };
}

// ---------------------------------------------------------------------------
// Action line parser
// ---------------------------------------------------------------------------

/**
 * Parse a single Action line into a UITarsAction.
 *
 * Examples:
 *   click(start_box='(197,525)')
 *   left_double(start_box='(100,200)')
 *   right_single(start_box='(300,400)')
 *   drag(start_box='(100,200)', end_box='(300,400)')
 *   hotkey(key='ctrl s')
 *   type(content='Hello world')
 *   scroll(start_box='(500,500)', direction='down')
 *   wait()
 *   finished()
 *   finished(content='Task completed')
 *   call_user()
 */
function parseActionLine(actionLine: string): UITarsAction | null {
  const trimmed = actionLine.trim();

  // Match: action_name(...)
  const fnMatch = trimmed.match(/^(\w+)\((.*)\)$/s);
  if (!fnMatch) return null;

  const type = fnMatch[1] as UITarsActionType;
  const paramsStr = fnMatch[2];

  // Parse named parameters: key='value'
  const params: Record<string, string> = {};
  // Match key='value' pairs, handling nested quotes
  const paramRegex = /(\w+)\s*=\s*'((?:[^'\\]|\\.)*)'/g;
  let paramMatch: RegExpExecArray | null;
  while ((paramMatch = paramRegex.exec(paramsStr)) !== null) {
    params[paramMatch[1]] = paramMatch[2].replace(/\\'/g, "'");
  }

  switch (type) {
    case 'click':
    case 'left_double':
    case 'right_single': {
      const startBox = params['start_box'] ? parseBox(params['start_box']) : null;
      if (!startBox) return null;
      return { type, startBox };
    }

    case 'drag': {
      const startBox = params['start_box'] ? parseBox(params['start_box']) : null;
      const endBox = params['end_box'] ? parseBox(params['end_box']) : null;
      if (!startBox || !endBox) return null;
      return { type, startBox, endBox };
    }

    case 'hotkey':
      return { type, key: params['key'] || '' };

    case 'type':
      return { type, content: params['content'] || '' };

    case 'scroll': {
      const startBox = params['start_box'] ? parseBox(params['start_box']) : null;
      const direction = params['direction'] as UITarsAction['direction'];
      return { type, startBox: startBox ?? undefined, direction };
    }

    case 'wait':
      return { type };

    case 'finished':
      return { type, content: params['content'] || '' };

    case 'call_user':
      return { type };

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse a full UI-TARS response (Thought + Action) into structured data.
 */
export function parseUITarsResponse(text: string): UITarsParsedResponse {
  let thought = '';
  let actionLine = '';

  // Split on "Action:" — everything before is thought, everything after is the action
  const actionIdx = text.indexOf('Action:');
  if (actionIdx >= 0) {
    const beforeAction = text.slice(0, actionIdx);
    actionLine = text.slice(actionIdx + 'Action:'.length).trim();

    // Extract thought from "Thought: ..." prefix
    const thoughtMatch = beforeAction.match(/Thought:\s*([\s\S]*)/);
    thought = thoughtMatch ? thoughtMatch[1].trim() : beforeAction.trim();
  } else {
    // No "Action:" found — entire text is thought (model didn't produce an action)
    thought = text.replace(/^Thought:\s*/i, '').trim();
  }

  const action = actionLine ? parseActionLine(actionLine) : null;

  return { thought, action, raw: text };
}

// ---------------------------------------------------------------------------
// Action → GACUA tool call conversion
// ---------------------------------------------------------------------------

/**
 * Convert normalized 0-1000 coordinates to screen pixel coordinates.
 */
function toPixel(
  normalized: number,
  screenSize: number,
): number {
  return Math.round((screenSize * normalized) / 1000);
}

/**
 * Convert a parsed UI-TARS action into a GACUA tool call
 * that can be executed by the .computer MCP tool.
 *
 * Returns { name, args } compatible with executeToolCall().
 */
export function uitarsActionToToolCall(
  action: UITarsAction,
  screenWidth: number,
  screenHeight: number,
): { name: string; args: Record<string, unknown> } | null {
  switch (action.type) {
    case 'click': {
      if (!action.startBox) return null;
      return {
        name: '.computer',
        args: {
          action: 'click',
          coordinate: [
            toPixel(action.startBox.x, screenWidth),
            toPixel(action.startBox.y, screenHeight),
          ],
        },
      };
    }

    case 'left_double': {
      if (!action.startBox) return null;
      return {
        name: '.computer',
        args: {
          action: 'click',
          coordinate: [
            toPixel(action.startBox.x, screenWidth),
            toPixel(action.startBox.y, screenHeight),
          ],
          num_clicks: 2,
        },
      };
    }

    case 'right_single': {
      if (!action.startBox) return null;
      return {
        name: '.computer',
        args: {
          action: 'click',
          coordinate: [
            toPixel(action.startBox.x, screenWidth),
            toPixel(action.startBox.y, screenHeight),
          ],
          button_type: 'right',
        },
      };
    }

    case 'drag': {
      if (!action.startBox || !action.endBox) return null;
      return {
        name: '.computer',
        args: {
          action: 'drag',
          startCoordinate: [
            toPixel(action.startBox.x, screenWidth),
            toPixel(action.startBox.y, screenHeight),
          ],
          endCoordinate: [
            toPixel(action.endBox.x, screenWidth),
            toPixel(action.endBox.y, screenHeight),
          ],
        },
      };
    }

    case 'hotkey': {
      if (!action.key) return null;
      // UI-TARS uses space-separated keys: "ctrl s" → ["ctrl", "s"]
      const keys = action.key.split(/\s+/).filter(Boolean);
      return {
        name: '.computer',
        args: {
          action: 'key',
          keys,
        },
      };
    }

    case 'type': {
      return {
        name: '.computer',
        args: {
          action: 'type',
          text: action.content || '',
        },
      };
    }

    case 'scroll': {
      // Map UI-TARS scroll direction to GACUA scroll
      const coordinate = action.startBox
        ? [
            toPixel(action.startBox.x, screenWidth),
            toPixel(action.startBox.y, screenHeight),
          ]
        : [Math.round(screenWidth / 2), Math.round(screenHeight / 2)];
      return {
        name: '.computer',
        args: {
          action: 'scroll',
          coordinate,
          direction: action.direction || 'down',
        },
      };
    }

    case 'wait': {
      return {
        name: '.computer',
        args: {
          action: 'wait',
          time: 2,
        },
      };
    }

    case 'finished':
    case 'call_user':
      // These are handled at the agent level, not as tool calls
      return null;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// UI-TARS system prompt (COMPUTER_USE template)
// ---------------------------------------------------------------------------

export const UITARS_COMPUTER_USE_SYSTEM_PROMPT = `You are a GUI agent. You are given a task and a screenshot of the current screen. You need to perform actions to complete the task.

# Action Space
click(start_box='(x1,y1)') - Click at the position (x1,y1). The coordinates are normalized to 0-1000 scale.
left_double(start_box='(x1,y1)') - Double click at the position.
right_single(start_box='(x1,y1)') - Right click at the position.
drag(start_box='(x1,y1)', end_box='(x2,y2)') - Drag from position to position.
hotkey(key='key1 key2') - Press keyboard shortcut. Keys are space-separated.
type(content='text') - Type the given text.
scroll(start_box='(x1,y1)', direction='up/down/left/right') - Scroll at position in direction.
wait() - Wait for the screen to update.
finished() - Call when the task is completed.

# Output Format
Thought: <your reasoning about what to do>
Action: <action with parameters>

# Important Rules
- Always output exactly ONE action per turn
- Coordinates are on a 0-1000 normalized scale relative to the screenshot dimensions
- Be precise with click coordinates — target the center of the element
- Use finished() when the task is done`;

// ---------------------------------------------------------------------------
// Helper: detect if a model name is UI-TARS
// ---------------------------------------------------------------------------

export function isUITarsModel(modelName: string): boolean {
  const lower = modelName.toLowerCase();
  return lower.includes('ui-tars') || lower.includes('uitars');
}
