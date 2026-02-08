/**
 * Auto-saves successful GACUA task executions as recipe files
 * and updates the recipe list in CLAUDE.md.
 *
 * @license Apache-2.0
 */

import { writeFile, readFile } from 'fs/promises';
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

interface RecipeData {
  prompt: string;
  actions: string[];
  turns: TurnMetrics[];
  totalMs: number;
  model: string;
  summary: string;
}

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

function buildRecipeContent(data: RecipeData): string {
  const date = new Date().toISOString().slice(0, 10);
  const duration = formatDuration(data.totalMs);

  let content = `# Recette : ${data.summary}\n\n`;
  content += `- **Date** : ${date}\n`;
  content += `- **Modele** : ${data.model}\n`;
  content += `- **Duree totale** : ${duration} (${data.turns.length} tours)\n`;
  content += `- **Statut** : OK\n\n`;

  content += `## Prompt envoye\n\n\`\`\`\n${data.prompt}\n\`\`\`\n\n`;

  content += `## Actions effectuees\n\n`;
  for (let i = 0; i < data.actions.length; i++) {
    content += `${i + 1}. ${data.actions[i]}\n`;
  }
  content += '\n';

  content += `## Metrics par tour\n\n`;
  content += `| Tour | Screenshot | Planning | Execution | Total | Actions |\n`;
  content += `|------|-----------|----------|-----------|-------|--------|\n`;
  for (const t of data.turns) {
    const actionsSummary = t.actions.length > 0
      ? t.actions.map(a => a.split('(')[0]).join(', ')
      : 'computer_done';
    content += `| ${t.turn} | ${t.screenshotMs}ms | ${t.planningMs}ms | ${t.executionMs}ms | ${t.totalMs}ms | ${actionsSummary} |\n`;
  }

  return content;
}

async function updateClaudeMdRecipeList(
  fileName: string,
  description: string,
  duration: string,
  model: string,
  date: string,
): Promise<void> {
  try {
    const content = await readFile(CLAUDE_MD_PATH, 'utf-8');
    const startMarker = '<!-- RECIPES_START -->';
    const endMarker = '<!-- RECIPES_END -->';

    const startIdx = content.indexOf(startMarker);
    const endIdx = content.indexOf(endMarker);
    if (startIdx === -1 || endIdx === -1) {
      recipeLogger.warn('CLAUDE.md missing RECIPES_START/END markers, skipping update');
      return;
    }

    const before = content.slice(0, endIdx);
    const after = content.slice(endIdx);

    const newLine = `| \`${fileName}\` | ${description} | ${duration} | ${model} | ${date} |\n`;

    // Check if recipe already exists in the table
    if (before.includes(fileName)) {
      recipeLogger.info({ fileName }, 'Recipe already in CLAUDE.md, skipping');
      return;
    }

    const updated = before + newLine + after;
    await writeFile(CLAUDE_MD_PATH, updated, 'utf-8');
    recipeLogger.info({ fileName }, 'Updated CLAUDE.md recipe list');
  } catch (err) {
    recipeLogger.warn({ err }, 'Failed to update CLAUDE.md recipe list');
  }
}

export async function saveRecipe(data: RecipeData): Promise<string | null> {
  try {
    const subject = sanitizeForFilename(data.summary);
    const duration = formatDuration(data.totalMs);
    const fileName = `recipe_${subject}_${duration}.md`;
    const filePath = join(RECIPES_DIR, fileName);

    const content = buildRecipeContent(data);
    await writeFile(filePath, content, 'utf-8');
    recipeLogger.info({ fileName, totalMs: data.totalMs }, 'Recipe saved');

    // Update CLAUDE.md
    const date = new Date().toISOString().slice(0, 10);
    await updateClaudeMdRecipeList(
      fileName,
      data.summary,
      duration,
      formatModelShort(data.model),
      date,
    );

    return fileName;
  } catch (err) {
    recipeLogger.error({ err }, 'Failed to save recipe');
    return null;
  }
}
