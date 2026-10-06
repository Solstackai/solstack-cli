import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateProject } from '../src/generate/index.js';
import { runOpenSpec } from '../src/openspec.js';
import type { ProjectConfig } from '../src/project.js';

const ALL_AGENTS = [
  { id: 'claude-code', name: 'Claude Code' },
  { id: 'codex', name: 'OpenAI Codex' },
  { id: 'cursor', name: 'Cursor' },
  { id: 'copilot-vscode', name: 'GitHub Copilot (VS Code)' },
  { id: 'devin', name: 'Devin Desktop' },
  { id: 'gemini-cli', name: 'Gemini CLI' },
];

function config(agents = ALL_AGENTS, overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    version: 1,
    server: 'https://solstack.example.com',
    repository: { id: '00000000-0000-0000-0000-000000000001', name: 'acme/web' },
    agents,
    requiredIntegrations: [{ id: 'github', name: 'GitHub' }],
    commandPrefix: 'ss',
    managedFiles: [],
    ...overrides,
  };
}

let root: string;
const read = (path: string) => readFile(join(root, path), 'utf8');
const json = async (path: string) => JSON.parse(await read(path)) as Record<string, any>;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'solstack-generate-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('generateProject', () => {
  it('writes command files, MCP config and the OpenSpec folder for every agent', async () => {
    const { result, config: saved } = await generateProject(root, config(), null);

    for (const path of [
      '.solstack/commands/propose.md',
      '.claude/commands/ss-propose.md',
      '.cursor/commands/ss-apply.md',
      '.github/prompts/ss-archive.prompt.md',
      '.agents/skills/ss-propose/SKILL.md',
      '.devin/workflows/ss-apply.md',
      '.gemini/commands/ss-archive.toml',
      '.solstack/openspec/config.yaml',
    ]) {
      expect(existsSync(join(root, path)), path).toBe(true);
    }
    expect(result.unsupportedAgents).toEqual([]);
    expect(saved.managedFiles).toContain('.claude/commands/ss-propose.md');

    expect(await read('.claude/commands/ss-propose.md')).toMatch(/allowed-tools: Bash\(solstack spec:\*\)[\s\S]*\$ARGUMENTS/);
    expect(await read('.gemini/commands/ss-propose.toml')).toContain('{{args}}');
    expect(await read('.agents/skills/ss-apply/SKILL.md')).toContain('name: "ss-apply"');
    expect(await read('AGENTS.md')).toContain('/ss-propose');
    expect(await read('CLAUDE.md')).toContain('@AGENTS.md');

    const stdio = { command: 'solstack', args: ['mcp'] };
    expect((await json('.mcp.json')).mcpServers.solstack).toEqual({ type: 'stdio', ...stdio });
    expect((await json('.cursor/mcp.json')).mcpServers.solstack).toEqual(stdio);
    expect((await json('.vscode/mcp.json')).servers.solstack).toEqual({ type: 'stdio', ...stdio });
    const gemini = await json('.gemini/settings.json');
    expect(gemini.mcpServers.solstack).toEqual(stdio);
    expect(gemini.context.fileName).toEqual(['AGENTS.md', 'GEMINI.md']);
  });

  it('keeps the OpenSpec folder usable through `solstack spec`', async () => {
    await generateProject(root, config([]), null);
    const created = await runOpenSpec(root, ['new', 'change', 'add-dark-mode']);
    expect(created.code, created.stderr).toBe(0);
    expect(existsSync(join(root, '.solstack/openspec/changes/add-dark-mode'))).toBe(true);
    const list = await runOpenSpec(root, ['list', '--json']);
    expect(JSON.parse(list.stdout).changes.map((c: { name: string }) => c.name)).toEqual(['add-dark-mode']);
  });

  it('changes nothing when run again', async () => {
    const first = await generateProject(root, config(), null);
    const second = await generateProject(root, first.config, first.config);
    expect(second.result.written).toEqual([]);
    expect(second.result.removed).toEqual([]);
  });

  it("preserves the developer's own instructions and MCP servers", async () => {
    await writeFile(join(root, 'AGENTS.md'), '# Team rules\n\nUse tabs.\n');
    await writeFile(join(root, 'CLAUDE.md'), 'Claude-specific notes.\n');
    await writeFile(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { sentry: { command: 'sentry-mcp' } } }));
    await mkdir(join(root, '.vscode'));
    await writeFile(join(root, '.vscode/mcp.json'), '// team servers\n{ "servers": {} }\n');

    const { result } = await generateProject(root, config(), null);

    expect(await read('AGENTS.md')).toMatch(/^# Team rules\n\nUse tabs\.\n\n<!-- solstack:start -->/);
    expect(await read('CLAUDE.md')).toMatch(/^Claude-specific notes\.\n\n<!-- solstack:start -->[\s\S]*@AGENTS\.md/);
    expect(Object.keys((await json('.mcp.json')).mcpServers)).toEqual(['sentry', 'solstack']);
    expect(await read('.vscode/mcp.json')).toBe('// team servers\n{ "servers": {} }\n');
    expect(result.warnings).toEqual([expect.stringContaining('.vscode/mcp.json is not plain JSON')]);
  });

  it('removes what belonged to agents that are no longer selected', async () => {
    await writeFile(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { sentry: { command: 'sentry-mcp' } } }));
    const first = await generateProject(root, config(), null);
    const onlyCursor = config(ALL_AGENTS.filter((a) => a.id === 'cursor'));
    const second = await generateProject(root, { ...onlyCursor, managedFiles: first.config.managedFiles }, first.config);

    expect(existsSync(join(root, '.claude'))).toBe(false);
    expect(existsSync(join(root, '.agents'))).toBe(false);
    expect(existsSync(join(root, '.gemini/commands'))).toBe(false);
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(root, '.vscode'))).toBe(false);
    expect(existsSync(join(root, '.cursor/commands/ss-propose.md'))).toBe(true);
    // The developer's own server stays; only solstack's entry goes.
    expect(await json('.mcp.json')).toEqual({ mcpServers: { sentry: { command: 'sentry-mcp' } } });
    expect(second.result.removed).toContain('.claude/commands/ss-propose.md');
  });

  it('renames command files when the prefix changes', async () => {
    const first = await generateProject(root, config([ALL_AGENTS[0]!]), null);
    await generateProject(root, { ...first.config, commandPrefix: 'acme' }, first.config);
    expect(existsSync(join(root, '.claude/commands/acme-propose.md'))).toBe(true);
    expect(existsSync(join(root, '.claude/commands/ss-propose.md'))).toBe(false);
    expect(await read('AGENTS.md')).toContain('/acme-propose');
  });
});
