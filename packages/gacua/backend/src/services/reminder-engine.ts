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
    message: 'Phase 1 OBSERVER : as-tu verifie ce qu\'il y a a l\'ecran AVANT cette action ? '
      + 'Si non, ton PREMIER message dans une session DOIT etre EXACTEMENT : '
      + '"Bonjour, je suis ton orchestrateur et je te donnerai mon instruction au prochain message" '
      + '— NE PAS raccourcir, NE PAS reformuler. Sans la partie "je te donnerai mon instruction au prochain message", '
      + 'Gemini va agir au lieu d\'attendre.',
  },

  // --- Any chat completion ---
  {
    condition: (ctx) => ctx.action === 'chat_completion',
    message: 'STOP — AVANT d\'envoyer le prochain message, tu DOIS : 1) GET screenshot_url avec le token, 2) LIRE l\'image, 3) VERIFIER que l\'action a reussi visuellement. Ne te fie JAMAIS au texte seul. Si tu ne verifies pas, tu vas enchainer des erreurs en cascade.',
  },
  {
    condition: (ctx) => ctx.action === 'chat_completion',
    message: 'REGLE ABSOLUE : chaque message a Gemini doit contenir 1 ou 2 instructions MAXIMUM. '
      + 'JAMAIS 3+. Si tu mets trop d\'etapes dans un seul message, Flash va boucler a l\'infini '
      + '(il refait la sequence en boucle au lieu d\'appeler computer_done). '
      + 'Decompose TOUJOURS en messages atomiques : 1 message = 1 action simple.',
  },

  // --- Task completed (computer_done detected) ---
  {
    condition: (ctx) =>
      ctx.action === 'chat_completion' && ctx.hasDone,
    message: 'Tache terminee. OBLIGATOIRE : fetch + verifie le screenshot final avant de continuer. Compare les metrics avec les recettes existantes.',
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
