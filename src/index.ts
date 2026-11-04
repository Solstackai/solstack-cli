#!/usr/bin/env node
import { Command } from 'commander';
import { checkBranch, checkCommit, checkCommits, checkOpenSpec, checkPullRequest } from './commands/check.js';
import { ciInit, ciRemove } from './commands/ci.js';
import { connect } from './commands/connect.js';
import { installHooks, uninstallHooks } from './commands/hooks.js';
import { init, update } from './commands/init.js';
import { login, logout } from './commands/login.js';
import { setup } from './commands/setup.js';
import { status } from './commands/status.js';
import { runMcpBridge } from './mcp-bridge.js';
import { runOpenSpec } from './openspec.js';
import type { AppliesTo, GuidanceKind } from './api.js';
import { requireProjectRoot } from './project.js';
import { installedStandards } from './standards.js';
import { bold, dim, red, UserError } from './ui.js';
import { VERSION } from './version.js';

const APPLIES_TO_LABEL: Record<AppliesTo, string> = {
  all: 'all repositories',
  selected: 'this repository and possibly others',
  repository: 'only this repository',
};

function handleError(error: unknown): never {
  if ((error as Error)?.name === 'ExitPromptError') process.exit(130);
  if (error instanceof UserError) console.error(red(error.message));
  else console.error(error);
  process.exit(1);
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv.slice(2);

  // Handled before option parsing: `mcp` must keep stdout clean for the protocol, and `spec` forwards
  // every argument to OpenSpec untouched.
  if (command === 'mcp') return runMcpBridge();
  if (command === 'spec') {
    const { code } = await runOpenSpec(requireProjectRoot(), rest, { stdio: 'inherit' });
    process.exit(code);
  }

  const program = new Command('solstack')
    .version(VERSION)
    .description('Spec-driven development with your coding agents, wired to your Solstack server.')
    .showHelpAfterError();

  program
    .command('login')
    .description('Sign in to a Solstack server with a personal access token')
    .option('--server <url>', 'server address')
    .option('--token <token>', 'access token (otherwise prompted, or SOLSTACK_TOKEN)')
    .action(async (options: { server?: string; token?: string }) => {
      await login(options);
    });

  program
    .command('logout')
    .description('Forget the stored access token')
    .option('--server <url>', 'server address')
    .action(logout);

  program
    .command('init')
    .description('Set this repository up with the API key an admin created for it')
    .requiredOption('--key <key>', 'repository API key')
    .option('--server <url>', 'server address')
    .option('--prefix <prefix>', 'command prefix, as in /<prefix>-propose', 'ss')
    .option('--force', 'switch an already set up folder to another repository')
    .action(init);

  program
    .command('update')
    .description("Regenerate this repository's files from the server's current setup")
    .action(update);

  program
    .command('setup')
    .description('One-time developer setup: sign in, connect integrations and register agents')
    .action(setup);

  program
    .command('connect [integration]')
    .description('Authorize an integration (default: whatever this repository still needs)')
    .action(connect);

  program
    .command('status')
    .description('Show what is set up and what is missing')
    .action(async () => {
      if (!(await status())) process.exitCode = 1;
    });

  const listings: { command: string; kind: GuidanceKind; what: string; none: string }[] = [
    {
      command: 'standards',
      kind: 'standard',
      what: "List this repository's engineering standards and where to read them",
      none: 'No engineering standards are installed in this repository.',
    },
    {
      command: 'intake',
      kind: 'intake',
      what: 'List the rules for writing tasks, comments, pull requests, commit messages and the like',
      none: 'No intake rules are installed in this repository.',
    },
    {
      command: 'context',
      kind: 'context',
      what: 'List the product and business context documents and where to read them',
      none: 'No product context is installed in this repository.',
    },
  ];
  for (const listing of listings) {
    program
      .command(listing.command)
      .description(listing.what)
      .option('--json', 'machine-readable output')
      .action(async (options: { json?: boolean }) => {
        const documents = await installedStandards(requireProjectRoot(), listing.kind);
        if (options.json) {
          console.log(JSON.stringify(documents, null, 2));
        } else if (!documents.length) {
          console.log(listing.none);
        } else {
          for (const document of documents) {
            console.log(`${bold(document.name)} ${dim(`(${document.slug})`)}`);
            if (document.description) console.log(`  ${document.description}`);
            if (document.appliesTo) console.log(`  Applies to: ${APPLIES_TO_LABEL[document.appliesTo]}`);
            console.log(`  ${dim(document.path)}`);
          }
        }
      });
  }

  const check = program.command('check').description("Check a commit message, branch or pull request against the team's checks, if any are on");
  const finish = (passed: boolean) => {
    if (!passed) process.exitCode = 1;
  };
  check
    .command('commit <file>')
    .description('Check a commit message file, as the commit-msg hook does')
    .option('--quiet', 'print only what fails')
    .action(async (file: string, options: { quiet?: boolean }) => finish(await checkCommit(file, options)));
  check
    .command('branch [name]')
    .description('Check a branch name (default: the current branch, unless it is the default branch)')
    .option('--quiet', 'print only what fails')
    .action(async (name: string | undefined, options: { quiet?: boolean }) => finish(await checkBranch(name, options)));
  check
    .command('pr')
    .description("Check a pull request's title, description and branch")
    .requiredOption('--title <title>', 'pull request title')
    .option('--body <text>', 'pull request description')
    .option('--body-file <file>', 'file holding the pull request description')
    .option('--branch <name>', 'branch the pull request comes from')
    .option('--quiet', 'print only what fails')
    .action(async (options: { title: string; body?: string; bodyFile?: string; branch?: string; quiet?: boolean }) =>
      finish(await checkPullRequest(options)),
    );

  check
    .command('commits')
    .description('Check every commit message between two points, as the CI workflow does')
    .requiredOption('--base <ref>', 'where the commits start, not included')
    .option('--head <ref>', 'where they end (default: HEAD)')
    .option('--quiet', 'print only what fails')
    .action(async (options: { base: string; head?: string; quiet?: boolean }) => finish(await checkCommits(options)));
  check
    .command('openspec')
    .description('Check that the changes between two points come with a valid OpenSpec change')
    .requiredOption('--base <ref>', 'what the changes are compared with')
    .option('--head <ref>', 'where they end (default: HEAD)')
    .option('--mode <mode>', 'warn or block', 'block')
    .option('--title <title>', 'pull request title, where [no-spec] skips this check')
    .option('--quiet', 'print only what fails')
    .action(async (options: { base: string; head?: string; mode: string; title?: string; quiet?: boolean }) => {
      if (options.mode !== 'warn' && options.mode !== 'block') throw new UserError('--mode must be warn or block.');
      finish(await checkOpenSpec({ ...options, mode: options.mode }));
    });

  const ci = program.command('ci').description("Run the team's checks on each pull request, with GitHub Actions");
  ci.command('init')
    .description('Write the workflow into this repository, or update it')
    .option('--openspec <mode>', 'require an OpenSpec change on pull requests: off, warn or block')
    .action(ciInit);
  ci.command('remove').description('Delete the workflow').action(ciRemove);

  const hooks = program.command('hooks').description("Run the team's checks on each commit and push, in this clone only");
  hooks.command('install').description('Install the commit-msg and pre-push hooks').action(installHooks);
  hooks.command('uninstall').description('Remove the hooks installed by solstack').action(uninstallHooks);

  program.command('mcp').description('Run the MCP bridge agents connect to (started by your agents)');
  program.command('spec').description('Run OpenSpec on this repository, e.g. `solstack spec list`');

  await program.parseAsync(argv);
}

main(process.argv).catch(handleError);
