import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GuidanceKind } from './api.js';
import { readProjectConfig } from './project.js';

export interface InstalledStandard {
  kind: GuidanceKind;
  slug: string;
  name: string;
  description: string;
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
      path,
    });
  }
  return standards.sort((a, b) => a.slug.localeCompare(b.slug));
}
