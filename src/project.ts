import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { UserError } from './ui.js';

export const SOLSTACK_DIR = '.solstack';
const CONFIG_FILE = 'config.json';

const projectConfigSchema = z.object({
  version: z.literal(1),
  server: z.string(),
  repository: z.object({ id: z.string(), name: z.string() }),
  agents: z.array(z.object({ id: z.string(), name: z.string() })),
  requiredIntegrations: z.array(z.object({ id: z.string(), name: z.string() })),
  commandPrefix: z.string(),
  /** Files written entirely by solstack, so `update` can remove the ones no longer needed. */
  managedFiles: z.array(z.string()).default([]),
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

/** Nearest ancestor of `start` that has been initialized with solstack. */
export function findProjectRoot(start = process.cwd()): string | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, SOLSTACK_DIR, CONFIG_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function requireProjectRoot(start = process.cwd()): string {
  const root = findProjectRoot(start);
  if (!root) throw new UserError('This is not a solstack repository. Run `solstack init --key <repository key>` in it first.');
  return root;
}

export async function gitRoot(start = process.cwd()): Promise<string | null> {
  try {
    const { stdout } = await promisify(execFile)('git', ['rev-parse', '--show-toplevel'], { cwd: start });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function readProjectConfig(root: string): Promise<ProjectConfig> {
  const path = join(root, SOLSTACK_DIR, CONFIG_FILE);
  try {
    return projectConfigSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    throw new UserError(`${path} is missing or invalid: ${(error as Error).message}`);
  }
}

export async function writeProjectConfig(root: string, config: ProjectConfig): Promise<void> {
  const path = join(root, SOLSTACK_DIR, CONFIG_FILE);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
}
