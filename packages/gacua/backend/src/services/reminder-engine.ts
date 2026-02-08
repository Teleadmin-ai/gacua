/**
 * Contextual reminder engine for GACUA API responses.
 *
 * Generates behavioral reminders based on what action is being performed,
 * so the orchestrator (Claude) gets context-specific pense-betes embedded
 * directly in the API response.
 *
 * @license Apache-2.0
 */

// ---------------------------------------------------------------------------
// Reminder context types
// ---------------------------------------------------------------------------

export type ReminderContext =
  | { action: 'session_create'; sessionName: string }
  | { action: 'session_list'; sessionCount: number }
  | { action: 'session_delete'; sessionId: string }
  | { action: 'chat_completion'; sessionId: string; stepNumber: number; hasDone: boolean }
  | { action: 'messages_list'; sessionId: string };

// ---------------------------------------------------------------------------
// Reminder rules — each rule has a condition and a message
// ---------------------------------------------------------------------------

interface ReminderRule {
  condition: (ctx: ReminderContext) => boolean;
  message: string | ((ctx: ReminderContext) => string);
}

const RULES: ReminderRule[] = [
  // --- Session creation ---
  {
    condition: (ctx) => ctx.action === 'session_create',
    message: 'Verifie si une recette existe deja pour cette tache (voir CLAUDE.md RECIPES).',
  },
  {
    condition: (ctx) => ctx.action === 'session_create',
    message: 'Le nom de session = titre de la recette. Choisis un nom descriptif.',
  },

  // --- First chat completion in a session (step 1) ---
  {
    condition: (ctx) =>
      ctx.action === 'chat_completion' && ctx.stepNumber === 1,
    message: 'Phase 1 OBSERVER : as-tu verifie ce qu\'il y a a l\'ecran ? Si non, envoie un message neutre d\'abord.',
  },

  // --- Any chat completion ---
  {
    condition: (ctx) => ctx.action === 'chat_completion',
    message: 'TOUJOURS fetcher le screenshot_url — c\'est la source de verite, pas le texte.',
  },

  // --- Task completed (computer_done detected) ---
  {
    condition: (ctx) =>
      ctx.action === 'chat_completion' && ctx.hasDone,
    message: 'Tache terminee. Verifie le screenshot final et compare les metrics avec les recettes existantes.',
  },
  {
    condition: (ctx) =>
      ctx.action === 'chat_completion' && ctx.hasDone,
    message: 'Si A/B testing : supprime les sessions inferieures, garde la meilleure.',
  },

  // --- Session list ---
  {
    condition: (ctx) =>
      ctx.action === 'session_list' && ctx.sessionCount > 50,
    message: (ctx) =>
      `Menage recommande : ${(ctx as Extract<ReminderContext, { action: 'session_list' }>).sessionCount} sessions. Supprime les echecs, doublons et sessions api-* jetables.`,
  },

  // --- Session delete ---
  {
    condition: (ctx) => ctx.action === 'session_delete',
    message: 'Verifie que la recette a ete sauvegardee avant de supprimer (recipes/).',
  },

  // --- Messages list ---
  {
    condition: (ctx) => ctx.action === 'messages_list',
    message: 'Les screenshots sont dans /images/{sessionId}/ — plus fiables que le texte.',
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate contextual reminders for a given API action.
 * Returns an array of reminder strings relevant to the current context.
 */
export function getReminders(ctx: ReminderContext): string[] {
  return RULES
    .filter((rule) => rule.condition(ctx))
    .map((rule) => typeof rule.message === 'function' ? rule.message(ctx) : rule.message);
}
