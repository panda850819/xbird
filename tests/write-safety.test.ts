import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { areLiveWritesDisabled, checkMutationSafety } from '../src/lib/write-safety.js';

const root = join(import.meta.dirname, '..');

function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync('bun', ['src/cli.ts', '--plain', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NO_COLOR: '1', ...env },
  });
}

describe('write safety', () => {
  it('recognizes explicit truthy kill-switch values', () => {
    for (const value of ['1', 'true', 'TRUE', 'yes', 'on']) {
      expect(areLiveWritesDisabled({ XBIRD_DISABLE_LIVE_WRITES: value })).toBe(true);
    }
    expect(areLiveWritesDisabled({ XBIRD_DISABLE_LIVE_WRITES: '0' })).toBe(false);
  });

  it('allows dry runs when live writes are disabled', () => {
    expect(checkMutationSafety({ dryRun: true }, { XBIRD_DISABLE_LIVE_WRITES: '1' })).toEqual({
      ok: true,
      dryRun: true,
    });
  });

  it('previews tweet, reply, and unbookmark without credentials or network access', () => {
    const tweet = runCli(['--dry-run', 'tweet', 'hello']);
    expect(tweet.status).toBe(0);
    expect(tweet.stdout).toContain('Dry run: would post tweet');
    expect(tweet.stdout).toContain('Text: hello');

    const reply = runCli(['--dry-run', 'reply', '12345678', 'hello']);
    expect(reply.status).toBe(0);
    expect(reply.stdout).toContain('Dry run: would reply to 12345678');

    const unbookmark = runCli(['--dry-run', 'unbookmark', '12345678']);
    expect(unbookmark.status).toBe(0);
    expect(unbookmark.stdout).toContain('Dry run: would remove bookmark for 12345678');
  });

  it('blocks mutation commands before credential resolution', () => {
    const result = runCli(['tweet', 'hello'], { XBIRD_DISABLE_LIVE_WRITES: '1' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Live writes are disabled by XBIRD_DISABLE_LIVE_WRITES');
    expect(result.stderr).not.toContain('Missing required credentials');
  });
});
