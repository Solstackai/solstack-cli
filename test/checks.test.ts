import { execFile, spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { StandardDoc } from '../src/api.js';
import { checksFileContent, findFailures, isGeneratedCommit, parseCommitMessage } from '../src/checks.js';
import { generateProject } from '../src/generate/index.js';
import { writeProjectConfig, type ProjectConfig } from '../src/project.js';

const run = promisify(execFile);
const TSX = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));
const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url));

const baseDoc: StandardDoc = {
  kind: 'intake',
  target: 'commits',
  slug: 'intake-commits',
  name: 'Commit messages',
  description: 'Use when writing a commit message.',
  content: '# Commits\n',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

const config: ProjectConfig = {
  version: 1,
  server: 'https://solstack.example.com',
  repository: { id: '00000000-0000-0000-0000-000000000001', name: 'acme/web' },
  agents: [],
  requiredIntegrations: [],
  commandPrefix: 'ss',
  managedFiles: [],
  standards: [],
  standardFiles: [],
};

describe('what checks.json holds', () => {
  it('is nothing at all when no check is on, including from servers that do not report them', () => {
    expect(checksFileContent([baseDoc])).toBeNull();
    expect(checksFileContent([{ ...baseDoc, checkMode: 'off', checks: { titleMaxLength: 50 } }])).toBeNull();
    expect(checksFileContent([])).toBeNull();
  });

  it('holds only what can be checked locally', () => {
    const content = checksFileContent([
      { ...baseDoc, checkMode: 'block', checks: { titleMaxLength: 50 } },
      { ...baseDoc, target: 'tasks', slug: 'intake-tasks', checkMode: 'block', checks: { bodyRequired: true } },
      { ...baseDoc, target: 'branches', slug: 'intake-branches', checkMode: 'warn', checks: { branchPattern: '^issue_' } },
    ]);
    expect(JSON.parse(content!)).toEqual({
      version: 1,
      sections: {
        commits: { mode: 'block', checks: { titleMaxLength: 50 } },
        branches: { mode: 'warn', checks: { branchPattern: '^issue_' } },
      },
    });
  });
});

describe('reading a commit message', () => {
  it('drops comments and everything below the scissors line', () => {
    const text = 'Add login\n\nAllow users to log in.\n# Please enter the commit message\n# ------------------------ >8 ------------------------\ndiff --git a b\n';
    expect(parseCommitMessage(text)).toEqual({ subject: 'Add login', body: 'Allow users to log in.' });
  });

  it('recognizes commits git writes for you', () => {
    for (const subject of [
      "Merge branch 'main' into feature",
      "Merge remote-tracking branch 'origin/main'",
      'Merge tag v1.0',
      'Merge pull request #12 from acme/feature',
      'Revert "Add login"',
      'fixup! Add login',
      'squash! Add login',
      'amend! Add login',
    ]) {
      expect(isGeneratedCommit(subject)).toBe(true);
    }
    expect(isGeneratedCommit('Merge the two login forms')).toBe(false);
    expect(isGeneratedCommit('Revert the login change')).toBe(false);
    expect(isGeneratedCommit('Add login')).toBe(false);
  });

  it('words failures for commits', () => {
    const words = { title: 'subject', body: 'body' };
    expect(findFailures({ titleMaxLength: 3, bodyRequired: true }, { title: 'Long subject', body: '' }, words)).toEqual([
      'The subject is longer than 3 characters.',
      'The body must not be empty.',
    ]);
  });

  it('matches the server on headings and spaces in patterns', () => {
    for (const body of ['## Steps to test', 'Steps to test:', '**Steps to test**']) {
      expect(findFailures({ bodyHeadings: ['Steps to test'] }, { body })).toEqual([]);
    }
    expect(findFailures({ titlePattern: '^\\[ISSUE_\\d+\\] - ' }, { title: '[ISSUE_1] -x' })).toHaveLength(1);
  });
});

describe('generating checks.json', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'solstack-checks-file-'));
    await mkdir(join(root, '.solstack', 'openspec'), { recursive: true });
  });
  const exists = () => readFile(join(root, '.solstack/checks.json'), 'utf8').catch(() => null);

  it('adds nothing to a repository without checks', async () => {
    const { result } = await generateProject(root, config, null, [baseDoc]);
    expect(result.written).not.toContain('.solstack/checks.json');
    expect(await exists()).toBeNull();
  });

  it('writes it when a check is on, removes it when they are all off, and leaves it alone offline', async () => {
    const on = { ...baseDoc, checkMode: 'block' as const, checks: { titleMaxLength: 50 } };
    const first = await generateProject(root, config, null, [on]);
    expect(first.config.managedFiles).toContain('.solstack/checks.json');
    expect(await exists()).toContain('titleMaxLength');

    const offline = await generateProject(root, first.config, first.config, null);
    expect(await exists()).toContain('titleMaxLength');
    expect(offline.result.removed).not.toContain('.solstack/checks.json');

    const off = await generateProject(root, offline.config, offline.config, [{ ...on, checkMode: 'off' }]);
    expect(off.result.removed).toContain('.solstack/checks.json');
    expect(await exists()).toBeNull();
    await rm(root, { recursive: true, force: true });
  });
});

describe('in a real git repository', () => {
  let work: string;
  let repo: string;
  let env: NodeJS.ProcessEnv;

  /** Runs a command without failing the test on a non-zero exit, because several are meant to. */
  const exec = (command: string, args: string[], cwd = repo): Promise<{ code: number; output: string }> =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, env });
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code: code ?? 1, output }));
    });
  const solstack = (...args: string[]) => exec('solstack', args);
  const commit = (message: string, ...flags: string[]) => exec('git', ['commit', '--allow-empty', '-m', message, ...flags]);

  async function setChecks(sections: unknown): Promise<void> {
    await writeFile(join(repo, '.solstack/checks.json'), `${JSON.stringify({ version: 1, sections })}\n`);
  }

  beforeAll(async () => {
    work = await mkdtemp(join(tmpdir(), 'solstack-checks-'));
    const bin = join(work, 'bin');
    await mkdir(bin);
    await writeFile(join(bin, 'solstack'), `#!/bin/sh\nexec "${TSX}" "${ENTRY}" "$@"\n`);
    await chmod(join(bin, 'solstack'), 0o755);
    env = {
      PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
      HOME: work,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    };
  });

  afterAll(async () => {
    await rm(work, { recursive: true, force: true });
  });

  beforeEach(async () => {
    repo = await mkdtemp(join(work, 'repo-'));
    await run('git', ['init', '-q', '-b', 'main'], { cwd: repo, env });
    await writeProjectConfig(repo, config);
  });

  it('says so and passes when no checks are on', async () => {
    const result = await solstack('check', 'branch', 'anything');
    expect(result.code).toBe(0);
    expect(result.output).toContain('No checks are turned on');
  }, 30_000);

  it('blocks with exit 1 and warns with exit 0', async () => {
    await writeFile(join(repo, 'message'), 'A very long subject line\n');
    await setChecks({ commits: { mode: 'block', checks: { titleMaxLength: 10 } } });
    const blocked = await solstack('check', 'commit', 'message');
    expect(blocked.code).toBe(1);
    expect(blocked.output).toContain('subject is longer than 10');

    await setChecks({ commits: { mode: 'warn', checks: { titleMaxLength: 10 } } });
    const warned = await solstack('check', 'commit', 'message');
    expect(warned.code).toBe(0);
    expect(warned.output).toContain('subject is longer than 10');
  }, 60_000);

  it('checks a pull request and its branch together', async () => {
    await setChecks({
      pull_requests: { mode: 'block', checks: { bodyHeadings: ['Steps to test'] } },
      branches: { mode: 'warn', checks: { branchPattern: '^issue_\\d+$' } },
    });
    await writeFile(join(repo, 'body'), '## Steps to test\n1. Log in.\n');

    const passes = await solstack('check', 'pr', '--title', 'Add login', '--body-file', 'body', '--branch', 'issue_1');
    expect(passes.code).toBe(0);

    const warned = await solstack('check', 'pr', '--title', 'Add login', '--body-file', 'body', '--branch', 'other');
    expect(warned.code).toBe(0);
    expect(warned.output).toContain('branch name');

    const blocked = await solstack('check', 'pr', '--title', 'Add login', '--body', 'No headings', '--branch', 'issue_1');
    expect(blocked.code).toBe(1);
    expect(blocked.output).toContain('"Steps to test"');
  }, 60_000);

  it('does not check the default branch unless named, but checks others', async () => {
    await setChecks({ branches: { mode: 'block', checks: { branchPattern: '^issue_\\d+$' } } });
    await commit('First');
    expect((await solstack('check', 'branch')).code).toBe(0);
    expect((await solstack('check', 'branch', 'main')).code).toBe(1);

    await exec('git', ['switch', '-q', '-c', 'feature']);
    expect((await solstack('check', 'branch')).code).toBe(1);
    await exec('git', ['switch', '-q', '-c', 'issue_7']);
    expect((await solstack('check', 'branch')).code).toBe(0);
  }, 60_000);

  it('hooks stop a bad commit, allow a good one, and can be skipped or removed', async () => {
    await setChecks({ commits: { mode: 'block', checks: { titlePattern: '^\\[ISSUE_\\d+\\] - ' } } });
    expect((await commit('Before hooks')).code).toBe(0);

    const installed = await solstack('hooks', 'install');
    expect(installed.code).toBe(0);
    expect(installed.output).toContain('--no-verify');

    const blocked = await commit('No prefix');
    expect(blocked.code).not.toBe(0);
    expect(blocked.output).toContain('must match the pattern');

    expect((await commit('[ISSUE_1] - Add login')).code).toBe(0);
    expect((await commit('Merge branch main')).code).toBe(0);
    expect((await commit('No prefix', '--no-verify')).code).toBe(0);

    expect((await solstack('hooks', 'uninstall')).code).toBe(0);
    expect((await commit('No prefix again')).code).toBe(0);
  }, 90_000);

  it('hooks stay out of the way in a warn-only repository and on a branch without solstack', async () => {
    await setChecks({ commits: { mode: 'warn', checks: { titleMaxLength: 3 } } });
    await solstack('hooks', 'install');
    const warned = await commit('Long subject');
    expect(warned.code).toBe(0);
    expect(warned.output).toContain('longer than 3');

    await rm(join(repo, '.solstack'), { recursive: true });
    expect((await commit('Long subject again')).code).toBe(0);
  }, 60_000);

  it('does not overwrite a hook it did not install, or remove one', async () => {
    const hooks = (await run('git', ['rev-parse', '--git-path', 'hooks'], { cwd: repo, env })).stdout.trim();
    const own = join(repo, hooks, 'commit-msg');
    await mkdir(join(repo, hooks), { recursive: true });
    await writeFile(own, '#!/bin/sh\nexit 0\n');

    const installed = await solstack('hooks', 'install');
    expect(installed.output).toContain('left alone');
    expect(await readFile(own, 'utf8')).toBe('#!/bin/sh\nexit 0\n');
    expect(await readFile(join(repo, hooks, 'pre-push'), 'utf8')).toContain('solstack check branch');

    await solstack('hooks', 'uninstall');
    expect(await readFile(own, 'utf8')).toBe('#!/bin/sh\nexit 0\n');
  }, 60_000);

  it('hooks do not stop anyone without solstack installed', async () => {
    await setChecks({ commits: { mode: 'block', checks: { titleMaxLength: 3 } } });
    await solstack('hooks', 'install');
    const saved = env.PATH;
    env.PATH = '/usr/bin:/bin';
    try {
      expect((await run('sh', ['-c', 'command -v solstack || echo missing'], { env })).stdout.trim()).toBe('missing');
      expect((await commit('Long subject')).code).toBe(0);
    } finally {
      env.PATH = saved;
    }
  }, 60_000);

  it('rejects a damaged checks file with a way to fix it', async () => {
    await writeFile(join(repo, '.solstack/checks.json'), 'not json');
    const result = await solstack('check', 'branch', 'x');
    expect(result.code).toBe(1);
    expect(result.output).toContain('solstack update');
  }, 30_000);
});
