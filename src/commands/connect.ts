import { setTimeout as sleep } from 'node:timers/promises';
import { api } from '../api.js';
import { openBrowser } from '../browser.js';
import { resolveSession } from '../credentials.js';
import { findProjectRoot, readProjectConfig } from '../project.js';
import { bold, dim, ok, UserError, warn } from '../ui.js';
import { missingIntegrations } from './status.js';

const POLL_INTERVAL_MS = 2_000;
const TIMEOUT_MS = 5 * 60_000;

/**
 * Opens the server's authorization flow for each integration in the browser and waits until the server
 * reports it connected. Without an argument, connects whatever the current repository still needs.
 */
export async function connect(integrationId?: string): Promise<void> {
  const root = findProjectRoot();
  const config = root ? await readProjectConfig(root) : null;
  const session = await resolveSession(config?.server);
  if (!session) throw new UserError('Sign in first with `solstack login`.');

  const me = await api.me(session.serverUrl, session.token);
  const targets = integrationId
    ? me.connections.filter((c) => c.id === integrationId)
    : missingIntegrations(me, config);
  if (integrationId && targets.length === 0) {
    const available = me.connections.map((c) => c.id).join(', ') || 'none';
    throw new UserError(`"${integrationId}" is not enabled on ${session.serverUrl}. Available: ${available}.`);
  }
  if (targets.length === 0) {
    console.log(ok('Everything required is already connected.'));
    return;
  }

  for (const target of targets) {
    const url = `${session.serverUrl}/api/connect/${encodeURIComponent(target.id)}/start`;
    console.log(`\nConnecting ${bold(target.name)}. Approve access in your browser.`);
    console.log(dim(`If it does not open, visit ${url}`));
    console.log(dim('You may be asked to sign in to the Solstack web portal first.'));
    openBrowser(url);

    const deadline = Date.now() + TIMEOUT_MS;
    let connected = false;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const latest = await api.me(session.serverUrl, session.token);
      const connection = latest.connections.find((c) => c.id === target.id);
      if (connection?.connected) {
        console.log(ok(`${target.name} connected as ${connection.accountName}`));
        connected = true;
        break;
      }
    }
    if (!connected) console.log(warn(`Still waiting on ${target.name}. Run \`solstack connect ${target.id}\` to try again.`));
  }
}
