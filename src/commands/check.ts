import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { findFailures, isGeneratedCommit, parseCommitMessage, readChecks, splitCommitMessage, type Section, type Written } from '../checks.js';
import { adapterFor } from '../generate/agents.js';
import { runOpenSpec } from '../openspec.js';
import { findProjectRoot, readProjectConfig, requireProjectRoot, SOLSTACK_DIR, type ProjectConfig } from '../project.js';
import { dim, fail, ok, warn } from '../ui.js';
import { WORKFLOW_FILE } from './ci.js';

const run = promisify(execFile);
const CHANGES_DIR = `${SOLSTACK_DIR}/openspec/changes`;

interface CheckOptions {
  /** Used by hooks: silent unless something fails, and no complaint outside a solstack repository. */
  quiet?: boolean;
}

interface Part {
  section: Section | undefined;
  written: Written;
  words?: { title: string; body: string };
  /** Says which of several things a failure is about, such as a commit. */
  label?: string;
}

/** A failure on the terminal, or as an annotation GitHub shows on the pull request's run. */
function printFailure(mode: Section['mode'], text: string): void {
  if (process.env.GITHUB_ACTIONS === 'true') {
    const escaped = text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.log(`::${mode === 'block' ? 'error' : 'warning'}::${escaped}`);
  } else {
    console.error(mode === 'block' ? fail(text) : warn(text));
  }
}

/** Prints what failed and says whether it should stop the commit, push or merge. Warnings never do. */
function report(parts: Part[], options: CheckOptions): boolean {
  let blocked = false;
  let checked = false;
  for (const { section, written, words, label } of parts) {
    if (!section) continue;
    checked = true;
    const failures = findFailures(section.checks, written, words);
    if (section.mode === 'block' && failures.length) blocked = true;
    for (const failure of failures) printFailure(section.mode, label ? `${label}: ${failure}` : failure);
  }
  if (blocked) console.error('Rejected by the team\'s checks. Fix these and try again.');
  else if (!options.quiet) console.log(checked ? ok('Done checking.') : dim('No checks are turned on for this.'));
  return !blocked;
}

/** The repository root, or null when a hook runs somewhere solstack is not set up, such as an older branch. */
function projectRoot(options: CheckOptions): string | null {
  return options.quiet ? findProjectRoot() : requireProjectRoot();
}

export async function checkCommit(file: string, options: CheckOptions): Promise<boolean> {
  const root = projectRoot(options);
  if (!root) return true;
  const { subject, body } = parseCommitMessage(await readFile(file, 'utf8'));
  if (isGeneratedCommit(subject)) return true;
  const { commits } = await readChecks(root);
  return report([{ section: commits, written: { title: subject, body }, words: WORDS }], options);
}

async function git(args: string[]): Promise<string | null> {
  try {
    return (await run('git', args)).stdout.trim() || null;
  } catch {
    return null;
  }
}

/** The current branch and whether it should be checked: a detached HEAD has no name, and the default branch is not a task's. */
async function currentBranch(): Promise<string | null> {
  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branch || branch === 'HEAD') return null;
  const remoteDefault = (await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']))?.replace(/^origin\//, '');
  return branch === remoteDefault || branch === 'main' || branch === 'master' ? null : branch;
}

export async function checkBranch(name: string | undefined, options: CheckOptions): Promise<boolean> {
  const root = projectRoot(options);
  if (!root) return true;
  const branch = name ?? (await currentBranch());
  if (!branch) {
    if (!options.quiet) console.log(dim('This branch is not checked.'));
    return true;
  }
  const { branches } = await readChecks(root);
  return report([{ section: branches, written: { branch } }], options);
}

const WORDS = { title: 'subject', body: 'body' };

/** Every commit between two points, which is how CI covers commits made without the hooks. */
export async function checkCommits(options: CheckOptions & { base: string; head?: string }): Promise<boolean> {
  const root = requireProjectRoot();
  const { commits } = await readChecks(root);
  if (!commits) return report([], options);
  const { stdout } = await run('git', ['log', '--format=%h%x00%B%x1e', `${options.base}..${options.head ?? 'HEAD'}`], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  });
  const parts: Part[] = [];
  for (const entry of stdout.split('\x1e')) {
    const [hash, message] = entry.trim().split('\x00');
    if (!hash || message === undefined) continue;
    const { subject, body } = splitCommitMessage(message);
    if (!isGeneratedCommit(subject)) parts.push({ section: commits, written: { title: subject, body }, words: WORDS, label: hash });
  }
  return report(parts.length ? parts : [{ section: commits, written: {} }], options);
}

const NO_SPEC_MARKER = '[no-spec]';

/** Files that come from Solstack itself: a change to only these, like an update, has nothing to specify. */
function solstackFiles(config: ProjectConfig): Set<string> {
  return new Set([
    'AGENTS.md',
    'CLAUDE.md',
    WORKFLOW_FILE,
    ...config.managedFiles,
    ...config.standardFiles,
    ...config.agents.flatMap((agent) => adapterFor(agent.id)?.jsonEdits.map((edit) => edit.path) ?? []),
  ]);
}

/** A pull request has to come with a valid OpenSpec change, active or archived, unless it only touches Solstack's files. */
export async function checkOpenSpec(options: CheckOptions & { base: string; head?: string; mode: Section['mode']; title?: string }): Promise<boolean> {
  const root = requireProjectRoot();
  if (options.title?.includes(NO_SPEC_MARKER)) {
    if (!options.quiet) console.log(dim(`Skipping the OpenSpec check, because the title contains ${NO_SPEC_MARKER}.`));
    return true;
  }
  const { stdout } = await run('git', ['diff', '--name-only', `${options.base}...${options.head ?? 'HEAD'}`], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  });
  const changed = stdout.split('\n').filter(Boolean);
  const ownFiles = solstackFiles(await readProjectConfig(root));
  const isOwn = (file: string) => (file.startsWith(`${SOLSTACK_DIR}/`) && !file.startsWith(`${CHANGES_DIR}/`)) || ownFiles.has(file);

  const inChanges = changed.filter((file) => file.startsWith(`${CHANGES_DIR}/`)).map((file) => file.slice(CHANGES_DIR.length + 1));
  const archived = inChanges.some((file) => file.startsWith('archive/'));
  // A change that was archived in this pull request also shows as deleted from here, so only look at ones still there.
  const active = [...new Set(inChanges.filter((file) => file.includes('/') && !file.startsWith('archive/')).map((file) => file.split('/')[0]!))].filter((name) =>
    existsSync(join(root, CHANGES_DIR, name)),
  );

  const failures: string[] = [];
  if (!active.length && !archived && changed.some((file) => !isOwn(file))) {
    failures.push(`This pull request has no OpenSpec change. Add one with the propose command, or put ${NO_SPEC_MARKER} in the title if it does not need one.`);
  }
  for (const name of active) {
    const result = await runOpenSpec(root, ['validate', name, '--strict']);
    if (result.code !== 0) failures.push(`The OpenSpec change "${name}" is not valid. Run: solstack spec validate "${name}" --strict`);
  }

  for (const failure of failures) printFailure(options.mode, failure);
  const blocked = options.mode === 'block' && failures.length > 0;
  if (blocked) console.error('Rejected by the team\'s checks. Fix these and try again.');
  else if (!options.quiet && !failures.length) console.log(ok('Done checking.'));
  return !blocked;
}

export async function checkPullRequest(options: CheckOptions & { title: string; body?: string; bodyFile?: string; branch?: string }): Promise<boolean> {
  const { pull_requests: pullRequests, branches } = await readChecks(requireProjectRoot());
  const body = options.bodyFile ? await readFile(options.bodyFile, 'utf8') : (options.body ?? '');
  return report(
    [
      { section: pullRequests, written: { title: options.title, body } },
      { section: branches, written: options.branch ? { branch: options.branch } : {} },
    ],
    options,
  );
}
