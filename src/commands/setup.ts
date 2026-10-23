import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chooseServer, resolveSession, type ServerChoice } from '../credentials.js';
import { adapterFor, MCP_SERVER_NAME, WORKFLOW_COMMANDS } from '../generate/agents.js';
import { findProjectRoot, gitRoot, readProjectConfig } from '../project.js';
import { bold, dim, ok, warn } from '../ui.js';
import { connect } from './connect.js';
import { login } from './login.js';
import { isOnPath, status } from './status.js';

const run = promisify(execFile);

/** Codex keeps MCP servers in the developer's own config, so it is registered here rather than in the repository. */
async function registerWithCodex(): Promise<void> {
  if (!(await isOnPath('codex'))) {
    console.log(warn('Codex is not installed. Once it is, run: codex mcp add solstack -- solstack mcp'));
    return;
  }
  try {
    await run('codex', ['mcp', 'get', MCP_SERVER_NAME]);
    console.log(ok('Codex already knows the solstack MCP server.'));
  } catch {
    await run('codex', ['mcp', 'add', MCP_SERVER_NAME, '--', 'solstack', 'mcp']);
    console.log(ok('Added the solstack MCP server to Codex.'));
  }
}

/** Says which server is used and why, so a forgotten default sign-in is never used by surprise. */
export function describeServer(choice: ServerChoice): string {
  switch (choice.source) {
    case 'environment':
      return `Server: ${choice.serverUrl} (from SOLSTACK_SERVER)`;
    case 'repository':
      return `Server: ${choice.serverUrl} (set by this repository in .solstack/config.json)`;
    case 'default':
      return `Server: ${choice.serverUrl} (your default sign-in; change it with \`solstack login --server <url>\`)`;
    case 'none':
      return 'Server: not chosen yet; you will be asked for its address.';
  }
}

/** Everything a developer does once per machine and repository: sign in, connect integrations, wire agents. */
export async function setup(): Promise<void> {
  const root = findProjectRoot();
  const config = root ? await readProjectConfig(root) : null;

  console.log(bold(describeServer(await chooseServer(config?.server))));
  const repository = root ? null : await gitRoot();
  if (repository) {
    console.log(
      warn(
        `${repository} is not set up with Solstack yet, so only your account is set up here. ` +
          'To set up this repository, run: solstack init --key <repository key>',
      ),
    );
  }

  console.log(bold('\n1. Sign in'));
  const session = await resolveSession(config?.server);
  if (session) console.log(ok(`Already signed in to ${session.serverUrl}.`));
  else await login({ server: config?.server });

  console.log(bold('\n2. Connect integrations'));
  await connect();

  console.log(bold('\n3. Agents'));
  if (!config) {
    console.log(dim('Run this inside a solstack repository to set up its agents.'));
  } else {
    for (const agent of config.agents) {
      const adapter = adapterFor(agent.id);
      if (!adapter) continue;
      if (agent.id === 'codex') await registerWithCodex();
      else if (adapter.manualMcpSetup) console.log(warn(`${agent.name}: ${adapter.manualMcpSetup}`));
      else console.log(ok(`${agent.name}: configured by the repository.`));
      if (agent.id === 'claude-code') {
        console.log(dim('    Claude Code asks you once to approve the "solstack" MCP server from .mcp.json. Approve it.'));
      }
      const commands = WORKFLOW_COMMANDS.map((c) => adapter.invocation(`${config.commandPrefix}-${c.id}`)).join(', ');
      console.log(dim(`    Commands: ${commands}`));
    }
    console.log(dim('Restart open agents and IDEs so they load the new commands and MCP server.'));
  }

  console.log(bold('\nStatus'));
  await status();
}
