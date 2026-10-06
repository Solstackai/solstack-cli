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

/**
 * Resolves which server and token to use. SOLSTACK_SERVER / SOLSTACK_TOKEN override everything (for CI);
 * otherwise a repository's configured server wins over the default login.
 */
export async function resolveSession(preferredServer?: string): Promise<Session | null> {
  const envServer = process.env.SOLSTACK_SERVER ? normalizeServerUrl(process.env.SOLSTACK_SERVER) : undefined;
  const serverUrl = envServer ?? preferredServer ?? (await readCredentials()).defaultServer;
  if (!serverUrl) return null;
  const token = process.env.SOLSTACK_TOKEN ?? (await readCredentials()).servers[serverUrl]?.token;
  return token ? { serverUrl, token } : null;
}
