import { describe, expect, it } from 'vitest';
import { parseJsonObject, removeEntry, setEntry, upsertManagedBlock } from '../src/generate/merge.js';

describe('upsertManagedBlock', () => {
  it('creates a file with just the block', () => {
    const result = upsertManagedBlock(null, 'Hello');
    expect(result).toContain('<!-- solstack:start -->');
    expect(result).toContain('Hello');
    expect(result.endsWith('<!-- solstack:end -->\n')).toBe(true);
  });

  it('appends to existing content and replaces only its own block later', () => {
    const first = upsertManagedBlock('# My project\n\nOur rules.\n', 'v1');
    expect(first.startsWith('# My project\n\nOur rules.\n\n<!-- solstack:start -->')).toBe(true);

    const edited = `${first}\nMore notes by the team.\n`;
    const second = upsertManagedBlock(edited, 'v2');
    expect(second).toContain('# My project');
    expect(second).toContain('More notes by the team.');
    expect(second).toContain('v2');
    expect(second).not.toContain('v1');
  });

  it('removes the block and keeps the rest', () => {
    const withBlock = upsertManagedBlock('# Mine\n', 'ours');
    expect(upsertManagedBlock(withBlock, null)).toBe('# Mine\n');
    expect(upsertManagedBlock(upsertManagedBlock(null, 'ours'), null)).toBe('');
  });
});

describe('JSON entries', () => {
  it('adds and removes one entry without touching others', () => {
    const original = { mcpServers: { github: { command: 'gh' } }, other: true };
    const added = setEntry(original, 'mcpServers', 'solstack', { command: 'solstack' });
    expect(added).toEqual({ mcpServers: { github: { command: 'gh' }, solstack: { command: 'solstack' } }, other: true });
    expect(removeEntry(added, 'mcpServers', 'solstack')).toEqual(original);
    expect(removeEntry({ mcpServers: { solstack: {} } }, 'mcpServers', 'solstack')).toEqual({});
  });

  it('refuses to parse JSON with comments rather than lose them', () => {
    expect(parseJsonObject('// mine\n{"servers": {}}')).toBeNull();
    expect(parseJsonObject(null)).toEqual({});
    expect(parseJsonObject('[1]')).toBeNull();
  });
});
