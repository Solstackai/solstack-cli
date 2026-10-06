import type { StandardDoc } from '../api.js';

const quote = (value: string) => JSON.stringify(value);

/**
 * An engineering standard as an Agent Skills `SKILL.md`. Agents read the description up front and load the
 * body only when the task matches it, so the description is what decides whether a standard gets used.
 */
export function standardSkill(standard: StandardDoc): string {
  const description =
    standard.description.trim() ||
    `Engineering standard "${standard.name}". Follow it whenever you change code in this repository.`;
  return [
    '---',
    `name: ${standard.slug}`,
    `description: ${quote(description)}`,
    'metadata:',
    '  source: solstack',
    `  title: ${quote(standard.name)}`,
    '---',
    '',
    '<!-- Managed by Solstack. Edit this standard in the Solstack admin panel; `solstack update` replaces this file. -->',
    '',
    standard.content.trim(),
    '',
  ].join('\n');
}
