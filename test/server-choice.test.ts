import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { describeServer } from '../src/commands/setup.js';
import { chooseServer, writeCredentials } from '../src/credentials.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'solstack-server-choice-'));
  process.env.SOLSTACK_CONFIG_DIR = dir;
  delete process.env.SOLSTACK_SERVER;
});

afterEach(async () => {
  delete process.env.SOLSTACK_CONFIG_DIR;
  delete process.env.SOLSTACK_SERVER;
  await rm(dir, { recursive: true, force: true });
});

describe('choosing the server', () => {
  it('prefers the repository over the default sign-in, and says so', async () => {
    await writeCredentials({ defaultServer: 'http://localhost:5173', servers: {} });
    const choice = await chooseServer('https://solstack.example.com');
    expect(choice).toEqual({ serverUrl: 'https://solstack.example.com', source: 'repository' });
    expect(describeServer(choice)).toContain('set by this repository');
  });

  it('falls back to the default sign-in outside a repository, and says how to change it', async () => {
    await writeCredentials({ defaultServer: 'http://localhost:5173', servers: {} });
    const choice = await chooseServer(undefined);
    expect(choice).toEqual({ serverUrl: 'http://localhost:5173', source: 'default' });
    expect(describeServer(choice)).toContain('solstack login --server');
  });

  it('lets SOLSTACK_SERVER override everything', async () => {
    process.env.SOLSTACK_SERVER = 'https://ci.example.com/';
    expect(await chooseServer('https://solstack.example.com')).toEqual({ serverUrl: 'https://ci.example.com', source: 'environment' });
  });

  it('reports when no server is known yet', async () => {
    expect(describeServer(await chooseServer(undefined))).toContain('not chosen yet');
  });
});
