import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { api } from './api.js';
import { resolveSession, type Session } from './credentials.js';
import { findProjectRoot, readProjectConfig, type ProjectConfig } from './project.js';
import { guidanceIsCurrent } from './standards.js';
import { VERSION } from './version.js';

const STATUS_TOOL = 'solstack_status';
const REPOSITORY_HEADER = 'X-Solstack-Repository';

const GUIDANCE_CHECK_MS = 3_000;
const OUTDATED_GUIDANCE =
  "The team's standards, intake rules or product context changed on the server, so the skills installed in this repository may be out of date. " +
  'Tell the developer to run `solstack update` and commit the result.';

/** Asks the server whether the installed skills are current, without holding up startup or failing it. */
async function guidanceNotice(session: Session, project: ProjectConfig): Promise<string | null> {
  const check = api
    .standards(session.serverUrl, session.token, project.repository.id)
    .then((latest) => (guidanceIsCurrent(project, latest) ? null : OUTDATED_GUIDANCE))
    .catch(() => null);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), GUIDANCE_CHECK_MS);
  });
  try {
    return await Promise.race([check, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Local stdio MCP server that forwards to the Solstack gateway with the developer's stored token.
 * Agents launch it as `solstack mcp`, so the MCP configuration committed to a repository holds no secrets
 * and is the same for every developer.
 *
 * If the gateway cannot be reached (not signed in, server down), the bridge still starts and exposes a
 * single status tool explaining what to fix, so the agent can tell the developer instead of failing silently.
 */
export async function runMcpBridge(): Promise<void> {
  const problem = (message: string) => `Solstack is not available: ${message}`;
  let upstream: Client | null = null;
  let failure: string | null = null;
  let notice: string | null = null;
  /** Set when the folder this started in is not a repository, so the agent's workspace folders can say which it is. */
  let useWorkspaceFolders: ((folders: string[]) => Promise<void>) | null = null;

  try {
    const root = findProjectRoot();
    const project = root ? await readProjectConfig(root) : null;
    const preferredServer = project?.server;
    const session = await resolveSession(preferredServer);
    if (!session) {
      failure = problem(
        preferredServer
          ? `you are not signed in to ${preferredServer}. Run \`solstack login\` in a terminal, then restart this agent.`
          : 'you are not signed in. Run `solstack login` in a terminal, then restart this agent.',
      );
    } else {
      const client = new Client({ name: 'solstack-bridge', version: VERSION });
      const headers: Record<string, string> = { Authorization: `Bearer ${session.token}` };
      // Lets the gateway apply the rules and tools scoped to this repository.
      if (project) headers[REPOSITORY_HEADER] = project.repository.id;
      await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', session.serverUrl), { requestInit: { headers } }));
      upstream = client;
      if (project) notice = await guidanceNotice(session, project);
      else {
        useWorkspaceFolders = async (folders) => {
          for (const folder of folders) {
            const found = findProjectRoot(folder);
            const config = found ? await readProjectConfig(found).catch(() => null) : null;
            if (config?.server === session.serverUrl) {
              headers[REPOSITORY_HEADER] = config.repository.id;
              return;
            }
          }
        };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const rejected = (error as { code?: unknown }).code === 401 || /\b401\b|unauthori[sz]ed/i.test(message);
    failure = problem(
      rejected
        ? 'the server rejected your access token. Run `solstack login` again, then restart this agent.'
        : `${message}. Check the server is reachable, then restart this agent.`,
    );
  }

  const server = new Server(
    { name: 'solstack', version: VERSION },
    {
      capabilities: { tools: {} },
      instructions: [upstream?.getInstructions() ?? failure, notice].filter(Boolean).join('\n\n') || undefined,
    },
  );

  // Agents do not all start this in the repository they work on. Those that report their workspace folders still get its rules.
  let repositoryFound: Promise<void> = Promise.resolve();
  server.oninitialized = () => {
    if (!useWorkspaceFolders || !server.getClientCapabilities()?.roots) return;
    const use = useWorkspaceFolders;
    repositoryFound = server
      .listRoots(undefined, { timeout: GUIDANCE_CHECK_MS })
      .then(({ roots }) => use(roots.filter((root) => root.uri.startsWith('file:')).map((root) => fileURLToPath(root.uri))))
      .catch(() => undefined);
  };

  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    await repositoryFound;
    if (upstream) return upstream.listTools(request.params);
    return {
      tools: [
        {
          name: STATUS_TOOL,
          description: 'Explains why the Solstack tools (GitHub, Trello) are unavailable and how to fix it.',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    await repositoryFound;
    if (upstream) return (await upstream.callTool(request.params)) as CallToolResult;
    return { isError: true, content: [{ type: 'text', text: failure ?? problem('unknown error') }] };
  });

  const transport = new StdioServerTransport();
  transport.onclose = () => void upstream?.close();
  await server.connect(transport);
}
