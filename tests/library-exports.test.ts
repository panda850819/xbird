import { describe, expect, it } from 'vitest';
import { resolveCredentials, TwitterClient } from '../src/index.js';

describe('library exports', () => {
  it('exposes primary library surface', () => {
    expect(typeof TwitterClient).toBe('function');
    expect(typeof resolveCredentials).toBe('function');
  });
});
