import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { normalizeUsername, verifyExpectedAccount } from '../src/lib/account-safety.js';

const root = join(import.meta.dirname, '..');

describe('expected account safety', () => {
  it('normalizes handles for comparison', () => {
    expect(normalizeUsername(' @Example ')).toBe('example');
  });

  it('accepts the expected authenticated account case-insensitively', async () => {
    const getCurrentUser = vi.fn().mockResolvedValue({
      success: true,
      user: { id: '1', username: 'Example', name: 'Example' },
    });

    await expect(verifyExpectedAccount({ getCurrentUser }, '@example')).resolves.toEqual({
      ok: true,
      username: 'Example',
    });
    expect(getCurrentUser).toHaveBeenCalledOnce();
  });

  it('rejects an authenticated account mismatch', async () => {
    const getCurrentUser = vi.fn().mockResolvedValue({
      success: true,
      user: { id: '1', username: 'personal', name: 'Personal' },
    });

    await expect(verifyExpectedAccount({ getCurrentUser }, 'work')).resolves.toEqual({
      ok: false,
      error: 'Authenticated account @personal does not match --expect-user @work',
      actualUsername: 'personal',
    });
  });

  it('includes the expected account in a dry-run preview', () => {
    const result = spawnSync(
      'bun',
      ['src/cli.ts', '--plain', '--dry-run', '--expect-user', '@Example', 'tweet', 'hello'],
      {
        cwd: root,
        encoding: 'utf8',
        env: { PATH: process.env.PATH, HOME: process.env.HOME, NO_COLOR: '1' },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Expected account: @Example');
  });
});
