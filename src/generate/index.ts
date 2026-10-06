import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StandardDoc } from '../api.js';
import { initOpenSpec } from '../openspec.js';
import { SOLSTACK_DIR, type ProjectConfig } from '../project.js';
import { adapterFor, WORKFLOW_COMMANDS, type AgentAdapter, type GeneratedFile, type JsonEdit } from './agents.js';
import { parseJsonObject, upsertManagedBlock } from './merge.js';
import { standardSkill } from './standards.js';

const TEMPLATES_DIR = fileURLToPath(new URL('../../templates', import.meta.url));

export interface GenerateResult {
  written: string[];
  removed: string[];
  warnings: string[];
  /** Agents in the repository's setup that this client version does not know how to configure. */
  unsupportedAgents: string[];
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function template(name: string): Promise<string> {
  return readFile(join(TEMPLATES_DIR, name), 'utf8');
}

/** Removes empty folders left behind after deleting a file, up to (not including) the project root. */
async function pruneEmptyDirs(root: string, relativeFile: string): Promise<void> {
  let dir = dirname(join(root, relativeFile));
  while (dir.startsWith(root) && dir !== root) {
    try {
      await rmdir(dir);
    } catch {
      return;
    }
    dir = dirname(dir);
  }
}

/**
 * Writes everything a repository needs for the selected agents: the shared command instructions, the
 * OpenSpec folder, AGENTS.md, each agent's command files and MCP configuration, and the repository's
 * engineering standards as skills. Safe to run again: files the developer owns are merged, and files from
 * agents or standards no longer selected are removed.
 *
 * `standards` is null when they could not be fetched (offline); the installed ones are then left as they are.
 */
export async function generateProject(
  root: string,
  config: ProjectConfig,
  previous: ProjectConfig | null,
  standards: StandardDoc[] | null,
): Promise<{ result: GenerateResult; config: ProjectConfig }> {
  const result: GenerateResult = { written: [], removed: [], warnings: [], unsupportedAgents: [] };

  async function writeIfChanged(relativePath: string, content: string): Promise<void> {
    const path = join(root, relativePath);
    if ((await readOptional(path)) === content) return;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
    result.written.push(relativePath);
  }

  const adapters: AgentAdapter[] = [];
  for (const agent of config.agents) {
    const adapter = adapterFor(agent.id);
    if (adapter) adapters.push(adapter);
    else result.unsupportedAgents.push(agent.name);
  }
  const selected = new Set(adapters.map((adapter) => adapter.id));
  const dropped = (previous?.agents ?? [])
    .map((agent) => adapterFor(agent.id))
    .filter((adapter): adapter is AgentAdapter => adapter !== undefined && !selected.has(adapter.id));

  // Files written entirely by solstack.
  const owned: GeneratedFile[] = [];
  for (const command of WORKFLOW_COMMANDS) {
    owned.push({ path: `${SOLSTACK_DIR}/commands/${command.id}.md`, content: await template(`commands/${command.id}.md`) });
  }
  for (const adapter of adapters) owned.push(...adapter.commandFiles(config.commandPrefix));
  for (const file of owned) await writeIfChanged(file.path, file.content);

  // Engineering standards, as one skill per standard in every selected agent's skills folder.
  const previousStandardFiles = new Set(previous?.standardFiles ?? []);
  let standardFiles = [...previousStandardFiles];
  if (standards !== null) {
    standardFiles = [];
    const reserved = new Set(WORKFLOW_COMMANDS.map((command) => `${config.commandPrefix}-${command.id}`));
    for (const standard of standards) {
      if (reserved.has(standard.slug)) {
        result.warnings.push(`"${standard.slug}" has the same name as a solstack command, so it was skipped. Rename it on the server.`);
        continue;
      }
      const content = standardSkill(standard);
      for (const adapter of adapters) {
        if (!adapter.skillsDir) continue;
        const path = `${adapter.skillsDir}/${standard.slug}/SKILL.md`;
        if (!previousStandardFiles.has(path) && existsSync(join(root, path))) {
          result.warnings.push(`${path} already exists and was not written by solstack, so it was left alone.`);
          continue;
        }
        await writeIfChanged(path, content);
        standardFiles.push(path);
      }
    }
  }

  if (!existsSync(join(root, SOLSTACK_DIR, 'openspec'))) {
    await mkdir(join(root, SOLSTACK_DIR), { recursive: true });
    await initOpenSpec(root);
    result.written.push(`${SOLSTACK_DIR}/openspec/`);
  }

  // Markdown files shared with the developer: only the section between solstack's markers is ours.
  const agentsBlock = (await template('agents-block.md')).replaceAll('{{prefix}}', config.commandPrefix);
  const markdown = new Map<string, string | null>([['AGENTS.md', agentsBlock]]);
  for (const adapter of dropped) for (const block of adapter.markdownBlocks) markdown.set(block.path, null);
  for (const adapter of adapters) for (const block of adapter.markdownBlocks) markdown.set(block.path, block.body);
  for (const [relativePath, body] of markdown) {
    const existing = await readOptional(join(root, relativePath));
    if (body === null && existing === null) continue;
    const next = upsertManagedBlock(existing, body);
    if (body === null && !next.trim()) {
      await rm(join(root, relativePath));
      result.removed.push(relativePath);
    } else {
      await writeIfChanged(relativePath, next);
    }
  }

  // JSON settings shared with the developer: only solstack's own entries are touched.
  const jsonFiles = new Map<string, { set: JsonEdit['set'][]; unset: JsonEdit['unset'][] }>();
  const jsonFile = (path: string) => {
    if (!jsonFiles.has(path)) jsonFiles.set(path, { set: [], unset: [] });
    return jsonFiles.get(path)!;
  };
  for (const adapter of dropped) for (const edit of adapter.jsonEdits) jsonFile(edit.path).unset.push(edit.unset);
  for (const adapter of adapters) for (const edit of adapter.jsonEdits) jsonFile(edit.path).set.push(edit.set);
  for (const [relativePath, edits] of jsonFiles) {
    const text = await readOptional(join(root, relativePath));
    if (text === null && edits.set.length === 0) continue;
    const document = parseJsonObject(text);
    if (document === null) {
      result.warnings.push(
        `${relativePath} is not plain JSON (it may contain comments), so it was left unchanged. ` +
          'Add an MCP server named "solstack" with command `solstack` and argument `mcp` by hand.',
      );
      continue;
    }
    let next = document;
    for (const unset of edits.unset) next = unset(next);
    for (const set of edits.set) next = set(next);
    if (Object.keys(next).length === 0 && edits.set.length === 0) {
      await rm(join(root, relativePath));
      result.removed.push(relativePath);
      await pruneEmptyDirs(root, relativePath);
    } else {
      await writeIfChanged(relativePath, `${JSON.stringify(next, null, 2)}\n`);
    }
  }

  // Files solstack wrote before but no longer needs (an agent was removed, or the prefix changed).
  const ownedPaths = owned.map((file) => file.path);
  for (const stale of previous?.managedFiles ?? []) {
    if (ownedPaths.includes(stale) || !existsSync(join(root, stale))) continue;
    await rm(join(root, stale));
    result.removed.push(stale);
    await pruneEmptyDirs(root, stale);
  }

  for (const stale of previousStandardFiles) {
    if (standardFiles.includes(stale) || !existsSync(join(root, stale))) continue;
    await rm(join(root, stale));
    result.removed.push(stale);
    await pruneEmptyDirs(root, stale);
  }

  return {
    result,
    config: {
      ...config,
      managedFiles: ownedPaths.sort(),
      standardFiles: standardFiles.sort(),
      standards:
        standards === null
          ? (previous?.standards ?? [])
          : standards.map(({ slug, updatedAt, kind }) => ({ slug, updatedAt, kind })),
    },
  };
}
