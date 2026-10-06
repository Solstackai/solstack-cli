import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOLSTACK_DIR } from './project.js';

/** The OpenSpec CLI bundled with this client, so every developer runs the same version. */
export function openspecBin(): string {
  const entry = fileURLToPath(import.meta.resolve('@fission-ai/openspec'));
  return join(dirname(dirname(entry)), 'bin', 'openspec.js');
}

function openspecEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // The version is pinned by solstack, and usage data stays local unless the developer opts in explicitly.
    OPENSPEC_NO_UPDATE_CHECK: '1',
    OPENSPEC_TELEMETRY: process.env.OPENSPEC_TELEMETRY ?? '0',
    OPENSPEC_NO_COMPLETIONS: '1',
    OPENSPEC_NO_ANIMATION: '1',
  };
}

/**
 * Runs OpenSpec with `.solstack` as its working directory. OpenSpec looks for the nearest `openspec/`
 * folder, so this is what keeps specs and changes inside `.solstack/openspec`.
 */
export function runOpenSpec(
  projectRoot: string,
  args: string[],
  options: { stdio?: 'inherit' | 'pipe' } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [openspecBin(), ...args], {
      cwd: join(projectRoot, SOLSTACK_DIR),
      env: openspecEnv(),
      stdio: options.stdio === 'inherit' ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** Creates `.solstack/openspec` (config, specs, changes) without any of OpenSpec's own agent files. */
export async function initOpenSpec(projectRoot: string): Promise<void> {
  const result = await runOpenSpec(projectRoot, ['init', '--tools', 'none', '--no-animation', '--no-copilot-cloud', '.']);
  if (result.code !== 0) throw new Error(`openspec init failed:\n${result.stderr || result.stdout}`);
}
