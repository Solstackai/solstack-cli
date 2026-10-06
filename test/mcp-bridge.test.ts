import type { Server as HttpServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { writeProjectConfig } from '../src/project.js';

const TOKEN = 'ssd_test-token';
const TSX = fileURLToPath(new URL('../../node_modules/.bin/tsx', import.meta.url));
const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url));

let gateway: HttpServer;
let gatewayUrl: string;
let workdir: string;
const seenAuthorization: string[] = [];
const seenRepository: (string | undefined)[] = [];

/** Stands in for the Solstack gateway: stateless Streamable HTTP with one tool. */
beforeAll(async () => {
  const app = express();
  app.post('/mcp', express.json(), async (req, res) => {
    seenAuthorization.push(req.get('authorization') ?? '');
    seenRepository.push(req.get('x-solstack-repository'));
    if (req.get('authorization') !== `Bearer ${TOKEN}`) {
      res.status(401).json({ error: 'Valid developer access token required' });
      return;
    }
    const server = new McpServer({ name: 'fake-gateway', version: '1.0.0' }, { instructions: 'Gateway instructions' });
    server.registerTool(
      'github_get_issue',
      { description: 'Get an issue', inputSchema: { issue_number: z.number() } },
      async ({ issue_number }) => ({ content: [{ type: 'text', text: `Issue #${issue_number}: Fix login` }] }),
    );
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => void transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  await new Promise<void>((resolve) => {
    gateway = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = gateway.address() as { port: number };
  gatewayUrl = `http://127.0.0.1:${address.port}`;
  workdir = await mkdtemp(join(tmpdir(), 'solstack-bridge-'));
});

afterAll(async () => {
  gateway.close();
  await rm(workdir, { recursive: true, force: true });
});

async function startBridge(env: Record<string, string>, cwd = workdir) {
  const client = new Client({ name: 'test-agent', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: TSX,
      args: [ENTRY, 'mcp'],
      cwd,
      env: { PATH: process.env.PATH ?? '', SOLSTACK_CONFIG_DIR: join(workdir, 'config'), ...env },
      stderr: 'pipe',
    }),
  );
  return client;
}

describe('solstack mcp', () => {
  it('forwards tools and calls to the gateway with the stored token', async () => {
    const client = await startBridge({ SOLSTACK_SERVER: gatewayUrl, SOLSTACK_TOKEN: TOKEN });
    try {
      expect(client.getInstructions()).toBe('Gateway instructions');
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(['github_get_issue']);
      const result = await client.callTool({ name: 'github_get_issue', arguments: { issue_number: 7 } });
      expect(result.content).toEqual([{ type: 'text', text: 'Issue #7: Fix login' }]);
      expect(seenAuthorization.every((header) => header === `Bearer ${TOKEN}`)).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('tells the gateway which repository the agent works in', async () => {
    const repository = join(workdir, 'repo');
    await writeProjectConfig(repository, {
      version: 1,
      server: gatewayUrl,
      repository: { id: '11111111-1111-4111-8111-111111111111', name: 'acme/web' },
      agents: [],
      requiredIntegrations: [],
      commandPrefix: 'ss',
      managedFiles: [],
      standards: [],
      standardFiles: [],
    });
    seenRepository.length = 0;
    const client = await startBridge({ SOLSTACK_SERVER: gatewayUrl, SOLSTACK_TOKEN: TOKEN }, repository);
    try {
      await client.listTools();
      expect(seenRepository.at(-1)).toBe('11111111-1111-4111-8111-111111111111');
    } finally {
      await client.close();
    }
  });

  it('explains what to fix when the developer is not signed in', async () => {
    const client = await startBridge({});
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(['solstack_status']);
      const result = await client.callTool({ name: 'solstack_status', arguments: {} });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('solstack login');
    } finally {
      await client.close();
    }
  });

  it('explains what to fix when the token is rejected', async () => {
    const client = await startBridge({ SOLSTACK_SERVER: gatewayUrl, SOLSTACK_TOKEN: 'ssd_revoked' });
    try {
      const result = await client.callTool({ name: 'solstack_status', arguments: {} });
      expect(JSON.stringify(result.content)).toContain('rejected your access token');
    } finally {
      await client.close();
    }
  });
});
