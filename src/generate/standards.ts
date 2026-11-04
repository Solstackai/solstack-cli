import type { AppliesTo, GuidanceKind, StandardDoc } from '../api.js';

const LEVEL_LABEL = { general: 'General business context', specific: 'Repository context', product: 'Product context' };

const APPLIES_TO_NOTE: Record<AppliesTo, string> = {
  all: 'Applies to all repositories. If it disagrees with a document for fewer repositories, follow that document.',
  selected:
    'Applies to this repository and possibly others. Follow it over a document for all repositories, but follow a document for only this repository over it.',
  repository: 'Applies only to this repository. If it disagrees with a broader document, follow this one.',
};

/** Tells an agent that loaded this document how it ranks against the others. Servers that do not report it get no note. */
function scopeNote({ appliesTo, contextLevel }: StandardDoc): string[] {
  if (!appliesTo) return [];
  const level = contextLevel ? `${LEVEL_LABEL[contextLevel]}. ` : '';
  return [`> ${level}${APPLIES_TO_NOTE[appliesTo]}`, ''];
}

/** Used when a document has no "when it applies" text, so agents still know when to load it. */
const FALLBACK_DESCRIPTION: Record<GuidanceKind, (name: string) => string> = {
  standard: (name) => `Engineering standard "${name}". Follow it whenever you change code in this repository.`,
  intake: (name) => `Team rule "${name}" for writing things that are not code. Follow it when writing what it covers.`,
  context: (name) =>
    `Product context "${name}". Read it to understand the business, its users and its terms before planning or naming things.`,
};

const quote = (value: string) => JSON.stringify(value);

/**
 * A standard, intake rule or product context document as an Agent Skills `SKILL.md`. Agents read the
 * description up front and load the body only when the task matches it, so the description decides
 * whether a document gets used.
 */
export function standardSkill(standard: StandardDoc): string {
  const description = standard.description.trim() || FALLBACK_DESCRIPTION[standard.kind](standard.name);
  return [
    '---',
    `name: ${standard.slug}`,
    `description: ${quote(description)}`,
    'metadata:',
    '  source: solstack',
    `  kind: ${standard.kind}`,
    `  title: ${quote(standard.name)}`,
    ...(standard.appliesTo ? [`  applies-to: ${standard.appliesTo}`] : []),
    '---',
    '',
    '<!-- Managed by Solstack. Edit it in the Solstack admin panel; `solstack update` replaces this file. -->',
    '',
    ...scopeNote(standard),
    standard.content.trim(),
    '',
  ].join('\n');
}
