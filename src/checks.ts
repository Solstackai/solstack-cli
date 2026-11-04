import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { StandardDoc } from './api.js';
import { SOLSTACK_DIR } from './project.js';
import { UserError } from './ui.js';

/** The checks a repository has turned on. The file only exists when at least one is. */
export const CHECKS_FILE = `${SOLSTACK_DIR}/checks.json`;

/** Must match the server, which only applies patterns to short values to keep a slow pattern from costing much. */
const MAX_PATTERN_INPUT = 500;

const LOCAL_SECTIONS = ['commits', 'pull_requests', 'branches'] as const;
export type LocalSection = (typeof LOCAL_SECTIONS)[number];

const sectionSchema = z.object({
  mode: z.enum(['warn', 'block']),
  checks: z.object({
    titleMaxLength: z.number().optional(),
    titlePattern: z.string().optional(),
    bodyRequired: z.boolean().optional(),
    bodyHeadings: z.array(z.string()).optional(),
    branchPattern: z.string().optional(),
  }),
});

const checksFileSchema = z.object({
  version: z.literal(1),
  sections: z.partialRecord(z.enum(LOCAL_SECTIONS), sectionSchema),
});

export type LocalChecks = z.infer<typeof checksFileSchema>['sections'];
export type Section = z.infer<typeof sectionSchema>;

/** What `checks.json` should contain for these documents, or null when none of them has a check turned on. */
export function checksFileContent(standards: StandardDoc[]): string | null {
  const sections: LocalChecks = {};
  for (const section of LOCAL_SECTIONS) {
    const rule = standards.find((standard) => standard.target === section);
    if (rule?.checkMode && rule.checkMode !== 'off' && rule.checks) {
      sections[section] = { mode: rule.checkMode, checks: rule.checks };
    }
  }
  return Object.keys(sections).length ? `${JSON.stringify({ version: 1, sections }, null, 2)}\n` : null;
}

export async function readChecks(root: string): Promise<LocalChecks> {
  let text: string;
  try {
    text = await readFile(join(root, CHECKS_FILE), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  try {
    return checksFileSchema.parse(JSON.parse(text)).sections;
  } catch (error) {
    throw new UserError(`${CHECKS_FILE} is invalid: ${(error as Error).message}. Run \`solstack update\`.`);
  }
}

function hasHeading(body: string, heading: string): boolean {
  const normalize = (line: string) =>
    line
      .trim()
      .replace(/^#+\s*/, '')
      .replace(/\*\*/g, '')
      .replace(/:\s*$/, '')
      .trim()
      .toLowerCase();
  const wanted = normalize(heading);
  return body.split('\n').some((line) => normalize(line) === wanted);
}

function matches(value: string, source: string): boolean {
  return new RegExp(source).test(value.slice(0, MAX_PATTERN_INPUT));
}

export interface Written {
  title?: string;
  body?: string;
  branch?: string;
}

/** What a commit, pull request or branch breaks, in the words shown to whoever wrote it. */
export function findFailures(checks: Section['checks'], written: Written, words = { title: 'title', body: 'description' }): string[] {
  const failures: string[] = [];
  if (written.title !== undefined) {
    if (checks.titleMaxLength && written.title.length > checks.titleMaxLength) {
      failures.push(`The ${words.title} is longer than ${checks.titleMaxLength} characters.`);
    }
    if (checks.titlePattern && !matches(written.title, checks.titlePattern)) {
      failures.push(`The ${words.title} must match the pattern ${checks.titlePattern}`);
    }
  }
  if (written.body !== undefined) {
    if (checks.bodyRequired && !written.body.trim()) failures.push(`The ${words.body} must not be empty.`);
    for (const heading of checks.bodyHeadings ?? []) {
      if (!hasHeading(written.body, heading)) failures.push(`It must contain the heading "${heading}".`);
    }
  }
  if (written.branch !== undefined && checks.branchPattern && !matches(written.branch, checks.branchPattern)) {
    failures.push(`The branch name must match the pattern ${checks.branchPattern}`);
  }
  return failures;
}

/** A commit message as git stores it: comment lines dropped, and nothing below the scissors line `--verbose` adds. */
export function parseCommitMessage(text: string): { subject: string; body: string } {
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    if (/^# -+ >8 -+$/.test(line)) break;
    if (!line.startsWith('#')) lines.push(line);
  }
  const [subject = '', ...rest] = lines.join('\n').trim().split('\n');
  return { subject: subject.trim(), body: rest.join('\n').trim() };
}

/** Commits git writes for you, which are not the author's message to format. */
export function isGeneratedCommit(subject: string): boolean {
  return /^(Merge (branch|remote-tracking branch|tag|commit|pull request) |Revert "|fixup! |squash! |amend! )/.test(subject);
}
