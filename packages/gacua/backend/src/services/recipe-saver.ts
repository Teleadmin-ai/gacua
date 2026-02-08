/**
 * Auto-saves successful GACUA task executions as recipe files.
 * Accumulates steps across multiple API calls in the same session.
 * The recipe file is rewritten after each step with the full sequence.
 * CLAUDE.md is updated between <!-- RECIPES_START/END --> markers.
 *
 * @license Apache-2.0
 */

import { writeFile, readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { logger } from '../logger.js';

const recipeLogger = logger.child({ module: 'recipe-saver' });

// Resolve project root (packages/gacua/backend/src/services -> 5 levels up)
const PROJECT_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const RECIPES_DIR = join(PROJECT_ROOT, 'recipes');
const CLAUDE_MD_PATH = join(PROJECT_ROOT, 'CLAUDE.md');

interface TurnMetrics {
  turn: number;
  screenshotMs: number;
  planningMs: number;
  executionMs: number;
  totalMs: number;
  actions: string[];
}

interface AgentMetrics {
  turns: TurnMetrics[];
  totalMs: number;
}

/** One step = one API call from the orchestrator */
interface RecipeStep {
  prompt: string;
  actions: string[];
  metrics: AgentMetrics;
  summary: string | null;
}

/** Accumulated session recipe */
interface SessionRecipe {
  sessionId: string;
  model: string;
  steps: RecipeStep[];
  startedAt: Date;
  lastFileName: string | null;
}

// In-memory accumulator per session
const sessionRecipes = new Map<string, SessionRecipe>();

function sanitizeForFilename(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^a-z0-9]+/g, '-')    // non-alphanum to dashes
    .replace(/^-+|-+$/g, '')        // trim dashes
    .slice(0, 60);                   // limit length
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return sec > 0 ? `${min}m${sec}s` : `${min}m`;
}

function formatModelShort(model: string): string {
  if (model.includes('flash')) return 'Flash';
  if (model.includes('pro')) return 'Pro';
  return model;
}

function buildRecipeContent(recipe: SessionRecipe): string {
  const date = recipe.startedAt.toISOString().slice(0, 10);
  const totalMs = recipe.steps.reduce((sum, s) => sum + s.metrics.totalMs, 0);
  const totalTurns = recipe.steps.reduce((sum, s) => sum + s.metrics.turns.length, 0);
  const duration = formatDuration(totalMs);

  // Use last summary as title, or first prompt
  const lastSummary = [...recipe.steps].reverse().find(s => s.summary)?.summary;
  const title = lastSummary ?? recipe.steps[0]?.prompt.slice(0, 80) ?? 'Untitled';

  let content = `# Recette : ${title}\n\n`;
  content += `- **Date** : ${date}\n`;
  content += `- **Modele** : ${recipe.model}\n`;
  content += `- **Duree totale** : ${duration} (${recipe.steps.length} etapes, ${totalTurns} tours)\n`;
  content += `- **Session** : ${recipe.sessionId}\n`;
  content += `- **Statut** : OK\n\n`;

  // Steps
  for (let i = 0; i < recipe.steps.length; i++) {
    const step = recipe.steps[i];
    content += `## Etape ${i + 1}\n\n`;
    content += `**Prompt** : \`${step.prompt}\`\n\n`;

    if (step.actions.length > 0) {
      content += `**Actions** :\n`;
      for (const action of step.actions) {
        content += `- ${action}\n`;
      }
      content += '\n';
    }

    content += `**Metrics** (${step.metrics.turns.length} tours, ${formatDuration(step.metrics.totalMs)}) :\n\n`;
    content += `| Tour | Screenshot | Planning | Execution | Total | Actions |\n`;
    content += `|------|-----------|----------|-----------|-------|--------|\n`;
    for (const t of step.metrics.turns) {
      const actionsSummary = t.actions.length > 0
        ? t.actions.map(a => a.split('(')[0]).join(', ')
        : 'done';
      content += `| ${t.turn} | ${t.screenshotMs}ms | ${t.planningMs}ms | ${t.executionMs}ms | ${t.totalMs}ms | ${actionsSummary} |\n`;
    }
    content += '\n';
  }

  return content;
}

function getRecipeFileName(recipe: SessionRecipe): string {
  const totalMs = recipe.steps.reduce((sum, s) => sum + s.metrics.totalMs, 0);
  const lastSummary = [...recipe.steps].reverse().find(s => s.summary)?.summary;
  const subject = sanitizeForFilename(lastSummary ?? recipe.steps[0]?.prompt ?? 'unknown');
  const duration = formatDuration(totalMs);
  return `recipe_${subject}_${duration}.md`;
}

async function updateClaudeMdRecipeList(
  fileName: string,
  description: string,
  duration: string,
  model: string,
  date: string,
  oldFileName: string | null,
): Promise<void> {
  try {
    let content = await readFile(CLAUDE_MD_PATH, 'utf-8');
    const startMarker = '<!-- RECIPES_START -->';
    const endMarker = '<!-- RECIPES_END -->';

    const startIdx = content.indexOf(startMarker);
    const endIdx = content.indexOf(endMarker);
    if (startIdx === -1 || endIdx === -1) {
      recipeLogger.warn('CLAUDE.md missing RECIPES_START/END markers, skipping update');
      return;
    }

    // Remove old entry if filename changed (recipe grew, duration changed)
    if (oldFileName && oldFileName !== fileName) {
      content = content.replace(new RegExp(`^.*${oldFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*\n`, 'm'), '');
    }

    // Remove existing entry for same filename (will re-add with updated info)
    content = content.replace(new RegExp(`^.*${fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*\n`, 'm'), '');

    const endIdx2 = content.indexOf(endMarker);
    const before = content.slice(0, endIdx2);
    const after = content.slice(endIdx2);

    const newLine = `| \`${fileName}\` | ${description} | ${duration} | ${model} | ${date} |\n`;
    const updated = before + newLine + after;
    await writeFile(CLAUDE_MD_PATH, updated, 'utf-8');
    recipeLogger.info({ fileName }, 'Updated CLAUDE.md recipe list');
  } catch (err) {
    recipeLogger.warn({ err }, 'Failed to update CLAUDE.md recipe list');
  }
}

/**
 * Append a step to the session recipe and rewrite the recipe file.
 * Called after each successful /v1/chat/completions response.
 */
export async function appendRecipeStep(
  sessionId: string,
  model: string,
  prompt: string,
  actions: string[],
  metrics: AgentMetrics,
  summary: string | null,
): Promise<string | null> {
  try {
    // Get or create session recipe
    let recipe = sessionRecipes.get(sessionId);
    if (!recipe) {
      recipe = {
        sessionId,
        model,
        steps: [],
        startedAt: new Date(),
        lastFileName: null,
      };
      sessionRecipes.set(sessionId, recipe);
    }

    // Append step
    recipe.steps.push({ prompt, actions, metrics, summary });

    // Compute new filename (may change as summary/duration evolves)
    const newFileName = getRecipeFileName(recipe);
    const oldFileName = recipe.lastFileName;

    // Delete old file if name changed
    if (oldFileName && oldFileName !== newFileName) {
      try {
        await unlink(join(RECIPES_DIR, oldFileName));
        recipeLogger.info({ oldFileName, newFileName }, 'Recipe renamed (deleted old)');
      } catch {
        // File may not exist, ignore
      }
    }

    // Write recipe file
    const filePath = join(RECIPES_DIR, newFileName);
    const content = buildRecipeContent(recipe);
    await writeFile(filePath, content, 'utf-8');
    recipe.lastFileName = newFileName;

    const totalMs = recipe.steps.reduce((sum, s) => sum + s.metrics.totalMs, 0);
    recipeLogger.info({
      fileName: newFileName,
      stepCount: recipe.steps.length,
      totalMs,
    }, 'Recipe updated');

    // Update CLAUDE.md
    const lastSummary = [...recipe.steps].reverse().find(s => s.summary)?.summary;
    const description = lastSummary ?? prompt.slice(0, 80);
    const date = recipe.startedAt.toISOString().slice(0, 10);
    await updateClaudeMdRecipeList(
      newFileName,
      description,
      formatDuration(totalMs),
      formatModelShort(model),
      date,
      oldFileName,
    );

    return newFileName;
  } catch (err) {
    recipeLogger.error({ err }, 'Failed to save recipe step');
    return null;
  }
}

/** Clean up session recipe data (e.g., when session is deleted) */
export function clearSessionRecipe(sessionId: string): void {
  sessionRecipes.delete(sessionId);
}
