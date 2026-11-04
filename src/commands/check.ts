import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { findFailures, isGeneratedCommit, parseCommitMessage, readChecks, type Section, type Written } from '../checks.js';
import { findProjectRoot, requireProjectRoot } from '../project.js';
import { dim, fail, ok, warn } from '../ui.js';

const run = promisify(execFile);

interface CheckOptions {
  /** Used by hooks: silent unless something fails, and no complaint outside a solstack repository. */
  quiet?: boolean;
}

interface Part {
  section: Section | undefined;
  written: Written;
  words?: { title: string; body: string };
}

/** Prints what failed and says whether it should stop the commit, push or merge. Warnings never do. */
function report(parts: Part[], options: CheckOptions): boolean {
  let blocked = false;
  let checked = false;
  for (const { section, written, words } of parts) {
    if (!section) continue;
    checked = true;
    const failures = findFailures(section.checks, written, words);
    if (section.mode === 'block' && failures.length) blocked = true;
    for (const failure of failures) console.error(section.mode === 'block' ? fail(failure) : warn(failure));
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
  return report([{ section: commits, written: { title: subject, body }, words: { title: 'subject', body: 'body' } }], options);
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
