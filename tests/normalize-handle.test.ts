import { describe, expect, it } from 'vitest';
import { mentionsQueryFromUserOption, normalizeHandle } from '../src/lib/normalize-handle.js';

const INVALID_HANDLE_REGEX = /Invalid --user handle/;

describe('normalizeHandle', () => {
  it('accepts bare handle', () => {
    expect(normalizeHandle('example')).toBe('example');
  });

  it('accepts @handle and trims whitespace', () => {
    expect(normalizeHandle('  @example  ')).toBe('example');
  });

  it('rejects empty input', () => {
    expect(normalizeHandle('')).toBeNull();
    expect(normalizeHandle('   ')).toBeNull();
    expect(normalizeHandle(null)).toBeNull();
  });

  it('rejects invalid characters and too-long handles', () => {
    expect(normalizeHandle('@stei-pete')).toBeNull();
    expect(normalizeHandle('@example!')).toBeNull();
    expect(normalizeHandle('a'.repeat(16))).toBeNull();
  });
});

describe('mentionsQueryFromUserOption', () => {
  it('returns null query when option omitted', () => {
    expect(mentionsQueryFromUserOption(undefined)).toEqual({ query: null, error: null });
  });

  it('returns normalized @query for valid handle', () => {
    expect(mentionsQueryFromUserOption('@example')).toEqual({ query: '@example', error: null });
    expect(mentionsQueryFromUserOption(' example ')).toEqual({ query: '@example', error: null });
  });

  it('returns error for invalid handle', () => {
    const result = mentionsQueryFromUserOption('@stei-pete');
    expect(result.query).toBeNull();
    expect(result.error).toMatch(INVALID_HANDLE_REGEX);
  });
});
