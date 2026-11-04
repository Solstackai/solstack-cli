import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { requireProjectRoot } from '../project.js';
import { dim, ok, UserError, warn } from '../ui.js';

const run = promisify(execFile);

const MARKER = '# Installed by `solstack hooks install`. Remove it with `solstack hooks uninstall`.';

const HOOKS: Record<string, string> = {
  'commit-msg': 'solstack check commit "$1" --quiet',
  'pre-push': 'solstack check branch --quiet',
};

/** Where git runs hooks from here, which also covers worktrees and a custom `core.hooksPath`. */
async function hooksDir(cwd?: string): Promise<string> {
  const options = cwd ? { cwd } : {};
  try {
    const { stdout } = await run('git', ['rev-parse', '--git-path', 'hooks'], options);
    return resolve(cwd ?? process.cwd(), stdout.trim());
  } catch {
    throw new UserError('This is not a git repository, so there is nowhere to install hooks.');
  }
}

async function readHook(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Git hooks are per clone and never committed, so each developer chooses whether to install them. */
export async function installHooks(): Promise<void> {
  requireProjectRoot();
  const dir = await hooksDir();
  await mkdir(dir, { recursive: true });
  for (const [name, command] of Object.entries(HOOKS)) {
    const path = join(dir, name);
    const existing = await readHook(path);
    if (existing !== null && !existing.includes(MARKER)) {
      console.log(warn(`${path} already exists, so it was left alone. To run the checks there too, add: ${command}`));
      continue;
    }
    // Agents and git clients without solstack on their PATH should not be stopped from committing.
    await writeFile(path, `#!/bin/sh\n${MARKER}\ncommand -v solstack >/dev/null 2>&1 || exit 0\nexec ${command}\n`);
    await chmod(path, 0o755);
    console.log(ok(`Installed ${name}.`));
  }
  console.log(dim('Checks run on each commit and push. `git commit --no-verify` and `git push --no-verify` skip them.'));
}

export async function uninstallHooks(): Promise<void> {
  const dir = await hooksDir();
  for (const name of Object.keys(HOOKS)) {
    const path = join(dir, name);
    const existing = await readHook(path);
    if (existing === null) continue;
    if (existing.includes(MARKER)) {
      await rm(path);
      console.log(ok(`Removed ${name}.`));
    } else {
      console.log(dim(`${path} was not installed by solstack, so it was left alone.`));
    }
  }
}

export async function hooksInstalled(cwd: string): Promise<boolean> {
  try {
    const dir = await hooksDir(cwd);
    const hooks = await Promise.all(Object.keys(HOOKS).map((name) => readHook(join(dir, name))));
    return hooks.every((hook) => hook?.includes(MARKER));
  } catch {
    return false;
  }
}
