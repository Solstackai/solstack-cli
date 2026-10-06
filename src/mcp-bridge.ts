import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { resolveSession } from './credentials.js';
import { findProjectRoot, readProjectConfig } from './project.js';
import { VERSION } from './version.js';

const STATUS_TOOL = 'solstack_status';

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
      await client.connect(
        new StreamableHTTPClientTransport(new URL('/mcp', session.serverUrl), {
          requestInit: {
            headers: {
              Authorization: `Bearer ${session.token}`,
              // Lets the gateway apply the rules scoped to this repository.
              ...(project ? { 'X-Solstack-Repository': project.repository.id } : {}),
            },
          },
        }),
      );
      upstream = client;
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
    { capabilities: { tools: {} }, instructions: upstream?.getInstructions() ?? failure ?? undefined },
  );

  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
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
    if (upstream) return (await upstream.callTool(request.params)) as CallToolResult;
    return { isError: true, content: [{ type: 'text', text: failure ?? problem('unknown error') }] };
  });

  const transport = new StdioServerTransport();
  transport.onclose = () => void upstream?.close();
  await server.connect(transport);
}
