import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerWithAntigravity } from '../src/antigravity.js';

let home: string;
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'));

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'solstack-antigravity-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('registering with Antigravity', () => {
  it('reports when Antigravity is not installed', async () => {
    expect(await registerWithAntigravity(home)).toEqual({ status: 'not-installed' });
  });

  it('adds the server to the current config location, keeping other servers', async () => {
    const path = join(home, '.gemini/config/mcp_config.json');
    await mkdir(join(home, '.gemini/config'), { recursive: true });
    await writeFile(path, JSON.stringify({ mcpServers: { gmail: { serverUrl: 'https://gmailmcp.googleapis.com/mcp/v1' } } }));

    expect(await registerWithAntigravity(home)).toEqual({ status: 'added', path });
    expect((await json(path)).mcpServers).toEqual({
      gmail: { serverUrl: 'https://gmailmcp.googleapis.com/mcp/v1' },
      solstack: { command: 'solstack', args: ['mcp'] },
    });
    expect(await registerWithAntigravity(home)).toEqual({ status: 'present', path });
  });

  it('uses the older location when only that one exists, creating the file', async () => {
    await mkdir(join(home, '.gemini/antigravity'), { recursive: true });
    const path = join(home, '.gemini/antigravity/mcp_config.json');
    expect(await registerWithAntigravity(home)).toEqual({ status: 'added', path });
    expect((await json(path)).mcpServers.solstack).toEqual({ command: 'solstack', args: ['mcp'] });
  });

  it('leaves a file it cannot parse alone', async () => {
    await mkdir(join(home, '.gemini/config'), { recursive: true });
    const path = join(home, '.gemini/config/mcp_config.json');
    await writeFile(path, '// mine\n{ "mcpServers": {} }');
    expect(await registerWithAntigravity(home)).toEqual({ status: 'unreadable', path });
    expect(await readFile(path, 'utf8')).toBe('// mine\n{ "mcpServers": {} }');
  });
});
