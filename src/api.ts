import { UserError } from './ui.js';

export interface RepositorySetup {
  repository: { id: string; name: string; gitUrl: string | null };
  agents: { id: string; name: string }[];
  requiredIntegrations: { id: string; name: string; available: boolean }[];
  server: { url: string; mcpUrl: string };
}

/** What a guidance document is for. All kinds are installed as agent skills. */
export type GuidanceKind = 'standard' | 'intake' | 'context';

export interface StandardDoc {
  kind: GuidanceKind;
  /** The built-in intake section (tasks, comments, pull_requests, commits) for intake rules that fill one. */
  target: string | null;
  slug: string;
  name: string;
  description: string;
  content: string;
  updatedAt: string;
}

export interface Me {
  user: { id: string; email: string; name: string; role: 'admin' | 'developer' };
  connections: {
    id: string;
    name: string;
    connected: boolean;
    status: 'active' | 'invalid' | null;
    accountName: string | null;
  }[];
  connectUrl: string;
}

export class ApiError extends UserError {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function get<T>(serverUrl: string, path: string, token: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${serverUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new UserError(`Could not reach ${serverUrl}: ${(error as Error).message}`);
  }
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    if (response.status === 401) {
      throw new ApiError(401, `${serverUrl} rejected the credentials (${body.error ?? 'unauthorized'}).`);
    }
    throw new ApiError(response.status, `${serverUrl} responded ${response.status}: ${body.error ?? response.statusText}`);
  }
  return body as T;
}

export const api = {
  repositoryByKey: (serverUrl: string, apiKey: string) => get<RepositorySetup>(serverUrl, '/api/v1/repository', apiKey),
  repository: (serverUrl: string, token: string, id: string) =>
    get<RepositorySetup>(serverUrl, `/api/v1/repositories/${encodeURIComponent(id)}`, token),
  standardsByKey: (serverUrl: string, apiKey: string) =>
    get<{ standards: StandardDoc[] }>(serverUrl, '/api/v1/repository/standards', apiKey).then((r) => r.standards),
  standards: (serverUrl: string, token: string, id: string) =>
    get<{ standards: StandardDoc[] }>(serverUrl, `/api/v1/repositories/${encodeURIComponent(id)}/standards`, token).then(
      (r) => r.standards,
    ),
  me: (serverUrl: string, token: string) => get<Me>(serverUrl, '/api/v1/me', token),
};
