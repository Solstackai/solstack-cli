import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { api, type Me } from '../api.js';
import { resolveSession } from '../credentials.js';
import { runOpenSpec } from '../openspec.js';
import { findProjectRoot, readProjectConfig, type ProjectConfig } from '../project.js';
import { bold, dim, fail, ok, warn } from '../ui.js';

/** Integrations this developer still has to connect: the repository's required ones, or all of them outside a repository. */
export function missingIntegrations(me: Me, config: ProjectConfig | null): Me['connections'] {
  const required = config ? new Set(config.requiredIntegrations.map((i) => i.id)) : null;
  return me.connections.filter((c) => !c.connected && (!required || required.has(c.id)));
}

/** Agents launch `solstack mcp` by name, so it has to be on the PATH they see. */
export async function isOnPath(command: string): Promise<boolean> {
  try {
    await promisify(execFile)(process.platform === 'win32' ? 'where' : 'which', [command]);
    return true;
  } catch {
    return false;
  }
}

/** Prints what is set up and what is missing. Returns false when something required is missing. */
export async function status(): Promise<boolean> {
  let healthy = true;
  const root = findProjectRoot();
  const config = root ? await readProjectConfig(root) : null;

  if (config) {
    console.log(`${bold('Repository')}   ${config.repository.name} ${dim(`(${root})`)}`);
    console.log(`${bold('Agents')}       ${config.agents.map((a) => a.name).join(', ') || 'none'}`);
  } else {
    console.log(dim('Not inside a solstack repository.'));
  }

  const session = await resolveSession(config?.server);
  if (!session) {
    console.log(fail(`Not signed in${config ? ` to ${config.server}` : ''}. Run \`solstack login\`.`));
    return false;
  }

  let me: Me;
  try {
    me = await api.me(session.serverUrl, session.token);
  } catch (error) {
    console.log(fail((error as Error).message));
    return false;
  }
  console.log(`${bold('Signed in')}    ${me.user.name} <${me.user.email}> on ${session.serverUrl}`);

  console.log(bold('\nIntegrations'));
  const required = new Set(config?.requiredIntegrations.map((i) => i.id) ?? []);
  for (const connection of me.connections) {
    const label = `${connection.name}${required.has(connection.id) ? dim(' (required)') : ''}`;
    if (connection.connected) console.log(`  ${ok(`${label}: ${connection.accountName}`)}`);
    else if (connection.status === 'invalid') console.log(`  ${fail(`${label}: authorization expired`)}`);
    else console.log(`  ${(required.has(connection.id) ? fail : warn)(`${label}: not connected`)}`);
  }
  for (const integration of config?.requiredIntegrations ?? []) {
    if (!me.connections.some((c) => c.id === integration.id)) {
      console.log(`  ${fail(`${integration.name}: required, but not enabled on the server`)}`);
      healthy = false;
    }
  }
  if (missingIntegrations(me, config).length) {
    healthy = false;
    console.log(dim('  Run `solstack connect` to connect what is missing.'));
  }

  if (root) {
    const result = await runOpenSpec(root, ['list', '--json']);
    const changes = result.code === 0 ? ((JSON.parse(result.stdout) as { changes?: unknown[] }).changes?.length ?? 0) : null;
    console.log(`\n${bold('OpenSpec')}     ${changes === null ? fail('could not read .solstack/openspec') : `${changes} active change${changes === 1 ? '' : 's'}`}`);
    if (changes === null) healthy = false;
  }

  if (!(await isOnPath('solstack'))) {
    console.log(warn('`solstack` is not on your PATH, so agents cannot start its MCP server. Install it globally.'));
    healthy = false;
  }
  return healthy;
}
