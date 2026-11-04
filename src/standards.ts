import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppliesTo, GuidanceKind, StandardDoc } from './api.js';
import { readProjectConfig, type ProjectConfig } from './project.js';

export interface InstalledStandard {
  kind: GuidanceKind;
  slug: string;
  name: string;
  description: string;
  appliesTo?: AppliesTo;
  /** One of the generated skill files; every agent's copy has the same content. */
  path: string;
}

function frontmatterValue(text: string, key: string): string | undefined {
  const raw = text.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm'))?.[1]?.trim();
  if (raw === undefined) return undefined;
  try {
    return raw.startsWith('"') ? (JSON.parse(raw) as string) : raw;
  } catch {
    return raw;
  }
}

/** Whether the skills installed in a repository match what the server has for it now. */
export function guidanceIsCurrent(config: Pick<ProjectConfig, 'standards'>, latest: StandardDoc[]): boolean {
  const installed = new Map(config.standards.map((s) => [s.slug, s.updatedAt]));
  return latest.length === installed.size && latest.every((s) => installed.get(s.slug) === s.updatedAt);
}

/** Documents of one kind installed in a repository, read from the skills `solstack update` wrote. */
export async function installedStandards(root: string, kind: GuidanceKind = 'standard'): Promise<InstalledStandard[]> {
  const config = await readProjectConfig(root);
  const standards: InstalledStandard[] = [];
  for (const { slug, kind: installedKind } of config.standards) {
    if (installedKind !== kind) continue;
    const path = config.standardFiles.find((file) => file.endsWith(`/${slug}/SKILL.md`));
    if (!path) continue;
    const text = await readFile(join(root, path), 'utf8').catch(() => null);
    if (text === null) continue;
    const frontmatter = text.split(/^---$/m)[1] ?? '';
    standards.push({
      kind,
      slug,
      name: frontmatterValue(frontmatter, 'title') ?? slug,
      description: frontmatterValue(frontmatter, 'description') ?? '',
      appliesTo: frontmatterValue(frontmatter, 'applies-to') as AppliesTo | undefined,
      path,
    });
  }
  return standards.sort((a, b) => a.slug.localeCompare(b.slug));
}
