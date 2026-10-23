import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { UserError } from './ui.js';

const credentialsSchema = z.object({
  defaultServer: z.string().optional(),
  servers: z
    .record(
      z.string(),
      z.object({
        token: z.string(),
        email: z.string(),
        name: z.string(),
      }),
    )
    .default({}),
});

export type Credentials = z.infer<typeof credentialsSchema>;

export function configDir(): string {
  if (process.env.SOLSTACK_CONFIG_DIR) return process.env.SOLSTACK_CONFIG_DIR;
  if (process.platform === 'win32' && process.env.APPDATA) return join(process.env.APPDATA, 'solstack');
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'solstack');
}

function credentialsPath(): string {
  return join(configDir(), 'credentials.json');
}

export function normalizeServerUrl(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    throw new UserError(`"${url}" is not a valid server URL. Use the full address, e.g. https://solstack.example.com`);
  }
}

export async function readCredentials(): Promise<Credentials> {
  try {
    return credentialsSchema.parse(JSON.parse(await readFile(credentialsPath(), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { servers: {} };
    throw new UserError(`Could not read ${credentialsPath()}: ${(error as Error).message}`);
  }
}

/** Stored readable by the current user only: it holds access tokens. */
export async function writeCredentials(credentials: Credentials): Promise<void> {
  const path = credentialsPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

export interface Session {
  serverUrl: string;
  token: string;
}

export interface ServerChoice {
  serverUrl: string | null;
  /** Why this server: SOLSTACK_SERVER, the repository's .solstack/config.json, or the default sign-in. */
  source: 'environment' | 'repository' | 'default' | 'none';
}

/**
 * Which server to talk to. SOLSTACK_SERVER overrides everything (for CI); otherwise a repository's
 * configured server wins over the default sign-in.
 */
export async function chooseServer(repositoryServer?: string): Promise<ServerChoice> {
  if (process.env.SOLSTACK_SERVER) return { serverUrl: normalizeServerUrl(process.env.SOLSTACK_SERVER), source: 'environment' };
  if (repositoryServer) return { serverUrl: repositoryServer, source: 'repository' };
  const { defaultServer } = await readCredentials();
  return defaultServer ? { serverUrl: defaultServer, source: 'default' } : { serverUrl: null, source: 'none' };
}

/** The server to use and the token for it (SOLSTACK_TOKEN, or the stored sign-in), if there is one. */
export async function resolveSession(repositoryServer?: string): Promise<Session | null> {
  const { serverUrl } = await chooseServer(repositoryServer);
  if (!serverUrl) return null;
  const token = process.env.SOLSTACK_TOKEN ?? (await readCredentials()).servers[serverUrl]?.token;
  return token ? { serverUrl, token } : null;
}
