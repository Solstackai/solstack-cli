#!/usr/bin/env node
import { Command } from 'commander';
import { connect } from './commands/connect.js';
import { init, update } from './commands/init.js';
import { login, logout } from './commands/login.js';
import { setup } from './commands/setup.js';
import { status } from './commands/status.js';
import { runMcpBridge } from './mcp-bridge.js';
import { runOpenSpec } from './openspec.js';
import { requireProjectRoot } from './project.js';
import { installedStandards } from './standards.js';
import { bold, dim, red, UserError } from './ui.js';
import { VERSION } from './version.js';

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

  program
    .command('standards')
    .description("List this repository's engineering standards and where to read them")
    .option('--json', 'machine-readable output')
    .action(async (options: { json?: boolean }) => {
      const standards = await installedStandards(requireProjectRoot());
      if (options.json) {
        console.log(JSON.stringify(standards, null, 2));
      } else if (!standards.length) {
        console.log('No engineering standards are installed in this repository.');
      } else {
        for (const standard of standards) {
          console.log(`${bold(standard.name)} ${dim(`(${standard.slug})`)}`);
          if (standard.description) console.log(`  ${standard.description}`);
          console.log(`  ${dim(standard.path)}`);
        }
      }
    });

  program.command('mcp').description('Run the MCP bridge agents connect to (started by your agents)');
  program.command('spec').description('Run OpenSpec on this repository, e.g. `solstack spec list`');

  await program.parseAsync(argv);
}

main(process.argv).catch(handleError);
