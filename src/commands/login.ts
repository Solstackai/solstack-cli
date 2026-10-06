import { confirm, input, password } from '@inquirer/prompts';
import { api } from '../api.js';
import { openBrowser } from '../browser.js';
import { normalizeServerUrl, readCredentials, writeCredentials } from '../credentials.js';
import { findProjectRoot, readProjectConfig } from '../project.js';
import { bold, dim, ok, UserError } from '../ui.js';

export async function login(options: { server?: string; token?: string }): Promise<string> {
  const root = findProjectRoot();
  const projectServer = root ? (await readProjectConfig(root)).server : undefined;
  const credentials = await readCredentials();
  const interactive = Boolean(process.stdin.isTTY);

  let serverUrl = options.server ?? projectServer ?? credentials.defaultServer;
  if (!serverUrl) {
    if (!interactive) throw new UserError('Pass the server address with --server.');
    serverUrl = await input({ message: 'Solstack server address', default: 'https://' });
  }
  serverUrl = normalizeServerUrl(serverUrl);

  let token = options.token ?? process.env.SOLSTACK_TOKEN;
  if (!token) {
    if (!interactive) throw new UserError('Pass an access token with --token or SOLSTACK_TOKEN.');
    const tokensPage = `${serverUrl}/access`;
    console.log(`Create a personal access token at ${bold(tokensPage)}`);
    if (await confirm({ message: 'Open that page in your browser?', default: true })) openBrowser(tokensPage);
    token = await password({ message: 'Paste the access token', mask: true });
  }

  const me = await api.me(serverUrl, token.trim());
  credentials.servers[serverUrl] = { token: token.trim(), email: me.user.email, name: me.user.name };
  if (!credentials.defaultServer || options.server) credentials.defaultServer = serverUrl;
  await writeCredentials(credentials);

  console.log(ok(`Signed in to ${serverUrl} as ${bold(me.user.name)} ${dim(`<${me.user.email}>`)}`));
  return serverUrl;
}

export async function logout(options: { server?: string }): Promise<void> {
  const credentials = await readCredentials();
  const root = findProjectRoot();
  const serverUrl = options.server
    ? normalizeServerUrl(options.server)
    : ((root ? (await readProjectConfig(root)).server : undefined) ?? credentials.defaultServer);
  if (!serverUrl || !credentials.servers[serverUrl]) {
    console.log('Not signed in.');
    return;
  }
  delete credentials.servers[serverUrl];
  if (credentials.defaultServer === serverUrl) credentials.defaultServer = Object.keys(credentials.servers)[0];
  await writeCredentials(credentials);
  console.log(ok(`Signed out of ${serverUrl}. The token still works until you revoke it at ${serverUrl}/access.`));
}
