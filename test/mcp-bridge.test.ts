import type { Server as HttpServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { writeProjectConfig } from '../src/project.js';

const TOKEN = 'ssd_test-token';
const TSX = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));
const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url));

let gateway: HttpServer;
let gatewayUrl: string;
let workdir: string;
const seenAuthorization: string[] = [];
const seenRepository: (string | undefined)[] = [];
let serverGuidance: { slug: string; updatedAt: string }[] = [];

/** Stands in for the Solstack gateway: stateless Streamable HTTP with one tool. */
beforeAll(async () => {
  const app = express();
  app.get('/api/v1/repositories/:id/standards', (_req, res) => {
    res.json({ standards: serverGuidance });
  });
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

async function startBridge(env: Record<string, string>, cwd = workdir, workspaceFolders?: string[]) {
  const client = new Client(
    { name: 'test-agent', version: '1.0.0' },
    { capabilities: workspaceFolders ? { roots: {} } : {} },
  );
  if (workspaceFolders) {
    client.setRequestHandler(ListRootsRequestSchema, async () => ({
      roots: workspaceFolders.map((folder) => ({ uri: pathToFileURL(folder).href })),
    }));
  }
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

  describe('starting outside the repository', () => {
    const REPOSITORY_ID = '33333333-3333-4333-8333-333333333333';

    async function repositoryFolder(name: string, server: string): Promise<string> {
      const folder = join(workdir, name);
      await writeProjectConfig(folder, {
        version: 1,
        server,
        repository: { id: REPOSITORY_ID, name: 'acme/roots' },
        agents: [],
        requiredIntegrations: [],
        commandPrefix: 'ss',
        managedFiles: [],
        standards: [],
        standardFiles: [],
      });
      return folder;
    }

    async function seenAfterListingTools(cwd: string, workspaceFolders?: string[]) {
      seenRepository.length = 0;
      const client = await startBridge({ SOLSTACK_SERVER: gatewayUrl, SOLSTACK_TOKEN: TOKEN }, cwd, workspaceFolders);
      try {
        await client.listTools();
        return seenRepository.at(-1);
      } finally {
        await client.close();
      }
    }

    it('finds it from the workspace folders the agent reports', async () => {
      const folder = await repositoryFolder('from-roots', gatewayUrl);
      const nested = join(folder, 'packages', 'api');
      await mkdir(nested, { recursive: true });
      const elsewhere = await mkdtemp(join(tmpdir(), 'solstack-elsewhere-'));
      try {
        expect(await seenAfterListingTools(elsewhere, [nested])).toBe(REPOSITORY_ID);
      } finally {
        await rm(elsewhere, { recursive: true, force: true });
      }
    });

    it('ignores a repository set up with another server', async () => {
      const folder = await repositoryFolder('other-server', 'https://other.example.com');
      const elsewhere = await mkdtemp(join(tmpdir(), 'solstack-elsewhere-'));
      try {
        expect(await seenAfterListingTools(elsewhere, [folder])).toBeUndefined();
      } finally {
        await rm(elsewhere, { recursive: true, force: true });
      }
    });

    it('still works when the agent reports no workspace folders', async () => {
      const elsewhere = await mkdtemp(join(tmpdir(), 'solstack-elsewhere-'));
      try {
        expect(await seenAfterListingTools(elsewhere)).toBeUndefined();
      } finally {
        await rm(elsewhere, { recursive: true, force: true });
      }
    });
  });

  describe('installed guidance', () => {
    const INSTALLED = { slug: 'backend-standards', kind: 'standard' as const, updatedAt: '2026-11-01T00:00:00.000Z' };

    async function instructionsIn(name: string): Promise<string | undefined> {
      const repository = join(workdir, name);
      await writeProjectConfig(repository, {
        version: 1,
        server: gatewayUrl,
        repository: { id: '22222222-2222-4222-8222-222222222222', name: 'acme/api' },
        agents: [],
        requiredIntegrations: [],
        commandPrefix: 'ss',
        managedFiles: [],
        standards: [INSTALLED],
        standardFiles: [],
      });
      const client = await startBridge({ SOLSTACK_SERVER: gatewayUrl, SOLSTACK_TOKEN: TOKEN }, repository);
      try {
        return client.getInstructions();
      } finally {
        await client.close();
      }
    }

    it('adds nothing when the skills match the server', async () => {
      serverGuidance = [{ slug: INSTALLED.slug, updatedAt: INSTALLED.updatedAt }];
      expect(await instructionsIn('current')).toBe('Gateway instructions');
    });

    it('tells the agent when the server has changes', async () => {
      serverGuidance = [{ slug: INSTALLED.slug, updatedAt: '2026-11-02T00:00:00.000Z' }];
      const instructions = await instructionsIn('edited');
      expect(instructions).toContain('Gateway instructions');
      expect(instructions).toContain('`solstack update`');

      serverGuidance = [];
      expect(await instructionsIn('removed')).toContain('`solstack update`');
    });
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
