import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { requireProjectRoot } from '../project.js';
import { dim, ok, UserError, warn } from '../ui.js';
import { VERSION } from '../version.js';

const run = promisify(execFile);

export const WORKFLOW_FILE = '.github/workflows/solstack-check.yml';
export type OpenSpecMode = 'off' | 'warn' | 'block';

const MARKER = '# Written by `solstack ci init`. Run it again to update this file, or `solstack ci remove` to delete it.';

/**
 * A GitHub Actions workflow running the team's checks on each pull request. Pull request text is passed through
 * environment variables and never placed in a script, so a crafted title cannot run commands.
 */
export function ciWorkflow(openspec: OpenSpecMode, version = VERSION): string {
  const openspecStep =
    openspec === 'off'
      ? ''
      : `      - name: Check for an OpenSpec change
        if: \${{ !cancelled() }}
        env:
          PR_TITLE: \${{ github.event.pull_request.title }}
          BASE_SHA: \${{ github.event.pull_request.base.sha }}
          HEAD_SHA: \${{ github.event.pull_request.head.sha }}
        run: solstack check openspec --mode ${openspec} --base "$BASE_SHA" --head "$HEAD_SHA" --title "$PR_TITLE"
`;
  return `${MARKER}
name: Solstack checks

on:
  pull_request:
    types: [opened, edited, synchronize, reopened, ready_for_review]

permissions:
  contents: read

jobs:
  solstack-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - name: Install Solstack
        run: npm install --global solstack@${version}
      - name: Check the pull request
        env:
          PR_TITLE: \${{ github.event.pull_request.title }}
          PR_BODY: \${{ github.event.pull_request.body }}
          PR_BRANCH: \${{ github.head_ref }}
        run: |
          printf '%s' "$PR_BODY" > "$RUNNER_TEMP/pull-request-body"
          solstack check pr --title "$PR_TITLE" --body-file "$RUNNER_TEMP/pull-request-body" --branch "$PR_BRANCH"
      - name: Check its commits
        if: \${{ !cancelled() }}
        env:
          BASE_SHA: \${{ github.event.pull_request.base.sha }}
          HEAD_SHA: \${{ github.event.pull_request.head.sha }}
        run: solstack check commits --base "$BASE_SHA" --head "$HEAD_SHA"
${openspecStep}`;
}

async function readWorkflow(root: string): Promise<string | null> {
  try {
    return await readFile(join(root, WORKFLOW_FILE), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function ciInit(options: { openspec?: string }): Promise<void> {
  if (options.openspec && !['off', 'warn', 'block'].includes(options.openspec)) {
    throw new UserError('--openspec must be off, warn or block.');
  }
  const root = requireProjectRoot();
  const existing = await readWorkflow(root);
  if (existing !== null && !existing.includes(MARKER)) {
    throw new UserError(`${WORKFLOW_FILE} already exists and was not written by solstack, so it was left alone.`);
  }
  // Running it again to update the Solstack version keeps the choice made before.
  const current = existing?.match(/check openspec --mode (warn|block)/)?.[1] as OpenSpecMode | undefined;
  const openspec = (options.openspec as OpenSpecMode | undefined) ?? current ?? 'off';

  await mkdir(dirname(join(root, WORKFLOW_FILE)), { recursive: true });
  await writeFile(join(root, WORKFLOW_FILE), ciWorkflow(openspec));
  console.log(ok(`Wrote ${WORKFLOW_FILE}, using Solstack ${VERSION}.`));

  const remote = await run('git', ['remote', 'get-url', 'origin'], { cwd: root }).then(({ stdout }) => stdout.trim()).catch(() => '');
  if (remote && !remote.includes('github')) console.log(warn(`This is a GitHub Actions workflow, and origin is ${remote}, so it may not run there.`));

  console.log(dim(`Requires an OpenSpec change: ${openspec === 'off' ? 'no' : openspec === 'warn' ? 'warns' : 'blocks'}.`));
  console.log('\nNext:');
  console.log('  1. Review and commit the file. It runs on the pull requests that follow.');
  console.log('  2. A failed check shows on the pull request, but the pull request can still be merged.');
  console.log(
    '     To stop that, make "solstack-check" a required status check in your branch protection settings, if your GitHub plan includes them.',
  );
}

export async function ciRemove(): Promise<void> {
  const root = requireProjectRoot();
  const existing = await readWorkflow(root);
  if (existing === null) {
    console.log(dim('There is no Solstack workflow here.'));
    return;
  }
  if (!existing.includes(MARKER)) throw new UserError(`${WORKFLOW_FILE} was not written by solstack, so it was left alone.`);
  await rm(join(root, WORKFLOW_FILE));
  await rmdir(join(root, '.github/workflows')).catch(() => undefined);
  await rmdir(join(root, '.github')).catch(() => undefined);
  console.log(ok(`Removed ${WORKFLOW_FILE}. If it was a required status check, remove that from your branch protection settings too.`));
}

export function ciInstalled(root: string): boolean {
  return existsSync(join(root, WORKFLOW_FILE));
}
