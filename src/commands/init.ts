import { input } from '@inquirer/prompts';
import { api, type RepositorySetup } from '../api.js';
import { normalizeServerUrl, readCredentials, resolveSession } from '../credentials.js';
import { adapterFor, WORKFLOW_COMMANDS } from '../generate/agents.js';
import { generateProject, type GenerateResult } from '../generate/index.js';
import { findProjectRoot, gitRoot, readProjectConfig, requireProjectRoot, writeProjectConfig, type ProjectConfig } from '../project.js';
import { bold, cyan, dim, ok, UserError, warn } from '../ui.js';

const PREFIX_PATTERN = /^[a-z][a-z0-9-]{0,19}$/;

function toConfig(setup: RepositorySetup, commandPrefix: string, previous: ProjectConfig | null): ProjectConfig {
  return {
    version: 1,
    server: setup.server.url,
    repository: { id: setup.repository.id, name: setup.repository.name },
    agents: setup.agents,
    requiredIntegrations: setup.requiredIntegrations.map(({ id, name }) => ({ id, name })),
    commandPrefix,
    managedFiles: previous?.managedFiles ?? [],
  };
}

function report(result: GenerateResult, config: ProjectConfig, setup: RepositorySetup): void {
  for (const path of result.written) console.log(`  ${cyan('write')}  ${path}`);
  for (const path of result.removed) console.log(`  ${cyan('remove')} ${path}`);
  if (!result.written.length && !result.removed.length) console.log(dim('  Everything is already up to date.'));
  for (const message of result.warnings) console.log(warn(message));
  for (const name of result.unsupportedAgents) {
    console.log(warn(`${name} is selected on the server, but this version of solstack cannot set it up yet.`));
  }
  for (const integration of setup.requiredIntegrations.filter((i) => !i.available)) {
    console.log(warn(`${integration.name} is required but not enabled on the server yet. Ask an admin to enable it.`));
  }

  const examples = config.agents
    .map((agent) => adapterFor(agent.id))
    .filter((adapter) => adapter !== undefined)
    .map((adapter) => {
      const name = config.agents.find((agent) => agent.id === adapter.id)!.name;
      const commands = WORKFLOW_COMMANDS.map((c) => adapter.invocation(`${config.commandPrefix}-${c.id}`)).join(', ');
      return `  ${name}: ${commands}`;
    });
  if (examples.length) console.log(`\nCommands:\n${examples.join('\n')}`);
}

async function chooseServer(explicit: string | undefined, previous: ProjectConfig | null): Promise<string> {
  if (explicit) return normalizeServerUrl(explicit);
  if (previous) return previous.server;
  const fromEnv = process.env.SOLSTACK_SERVER;
  if (fromEnv) return normalizeServerUrl(fromEnv);
  const { defaultServer } = await readCredentials();
  if (defaultServer) return defaultServer;
  if (!process.stdin.isTTY) throw new UserError('Pass the server address with --server.');
  return normalizeServerUrl(await input({ message: 'Solstack server address', default: 'https://' }));
}

/** Sets a repository up for the first time, using the API key an admin created for it. */
export async function init(options: { key: string; server?: string; prefix: string; force?: boolean }): Promise<void> {
  if (!PREFIX_PATTERN.test(options.prefix)) {
    throw new UserError('The command prefix must be lowercase letters, digits or "-", starting with a letter.');
  }
  const root = findProjectRoot() ?? (await gitRoot()) ?? process.cwd();
  if (!(await gitRoot())) console.log(warn('This folder is not a git repository. Continuing in the current folder.'));

  const previous = findProjectRoot() ? await readProjectConfig(root) : null;
  const serverUrl = await chooseServer(options.server, previous);
  const setup = await api.repositoryByKey(serverUrl, options.key.trim());

  if (previous && previous.repository.id !== setup.repository.id && !options.force) {
    throw new UserError(
      `This folder is set up for "${previous.repository.name}", but that key belongs to "${setup.repository.name}". ` +
        'Use --force to switch.',
    );
  }

  console.log(`Setting up ${bold(setup.repository.name)} in ${root}`);
  const { result, config } = await generateProject(root, toConfig(setup, options.prefix, previous), previous);
  await writeProjectConfig(root, config);
  report(result, config, setup);

  console.log(`\n${ok('Done.')} Next:`);
  console.log('  1. Review and commit the changes, including the .solstack folder.');
  console.log('  2. Each developer installs the client and runs `solstack setup` in this repository.');
}

/** Regenerates the repository's files from the server's current setup (or the local one when offline). */
export async function update(): Promise<void> {
  const root = requireProjectRoot();
  const previous = await readProjectConfig(root);
  const session = await resolveSession(previous.server);
  let setup: RepositorySetup;
  if (session) {
    setup = await api.repository(session.serverUrl, session.token, previous.repository.id);
  } else {
    console.log(warn(`Not signed in to ${previous.server}; regenerating from the local configuration only.`));
    setup = {
      repository: { ...previous.repository, gitUrl: null },
      agents: previous.agents,
      requiredIntegrations: previous.requiredIntegrations.map((i) => ({ ...i, available: true })),
      server: { url: previous.server, mcpUrl: `${previous.server}/mcp` },
    };
  }
  const { result, config } = await generateProject(root, toConfig(setup, previous.commandPrefix, previous), previous);
  await writeProjectConfig(root, config);
  console.log(`Updated ${bold(config.repository.name)}`);
  report(result, config, setup);
}
