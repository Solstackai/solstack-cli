import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { MCP_SERVER_NAME } from './generate/agents.js';
import { parseJsonObject, setEntry } from './generate/merge.js';

/**
 * Where Antigravity keeps its MCP servers, newest first. It reads them from the user's home folder,
 * not from the repository, and the location moved between versions.
 */
const CONFIG_FILES = ['.gemini/config/mcp_config.json', '.gemini/antigravity/mcp_config.json'];

export type AntigravityResult =
  | { status: 'added' | 'present'; path: string }
  | { status: 'unreadable'; path: string }
  | { status: 'not-installed' };

/** Adds the solstack MCP server to Antigravity's configuration, keeping every other server in it. */
export async function registerWithAntigravity(home = homedir()): Promise<AntigravityResult> {
  const relative = CONFIG_FILES.find((file) => existsSync(dirname(join(home, file))));
  if (!relative) return { status: 'not-installed' };
  const path = join(home, relative);

  const text = existsSync(path) ? await readFile(path, 'utf8') : null;
  const document = parseJsonObject(text);
  if (document === null) return { status: 'unreadable', path };

  const servers = (document.mcpServers ?? {}) as Record<string, { command?: string; args?: string[] }>;
  const current = servers[MCP_SERVER_NAME];
  if (current?.command === 'solstack' && current.args?.join(' ') === 'mcp') return { status: 'present', path };

  const next = setEntry(document, 'mcpServers', MCP_SERVER_NAME, { command: 'solstack', args: ['mcp'] });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
  return { status: 'added', path };
}
