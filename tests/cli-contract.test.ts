import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createCliContext } from '../src/cli/shared.js';
import {
  CLI_EXIT_CODES,
  classifyCliError,
  createErrorEnvelope,
  createSuccessEnvelope,
  exitCodeForError,
} from '../src/lib/cli-contract.js';

const root = join(import.meta.dirname, '..');

function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  const cleanEnv = { PATH: process.env.PATH, HOME: process.env.HOME, NO_COLOR: '1', ...env };
  return spawnSync('bun', ['--no-env-file', 'src/cli.ts', '--plain', ...args, '--json'], {
    cwd: root,
    encoding: 'utf8',
    env: cleanEnv,
  });
}

describe('CLI contract', () => {
  it('creates stable success and partial envelopes', () => {
    expect(createSuccessEnvelope({ value: 1 })).toEqual({
      ok: true,
      data: { value: 1 },
      meta: { partial: false },
    });
    expect(
      createErrorEnvelope('page two failed', {
        code: 'PARTIAL_RESULT',
        data: ['first-page'],
        meta: { nextCursor: 'cursor-2' },
      }),
    ).toEqual({
      ok: false,
      error: { code: 'PARTIAL_RESULT', message: 'page two failed' },
      data: ['first-page'],
      meta: { partial: true, nextCursor: 'cursor-2' },
    });
    expect(exitCodeForError('page two failed', 'PARTIAL_RESULT')).toBe(CLI_EXIT_CODES.partial);
  });

  it('classifies rate limits and exposes Retry-After metadata', () => {
    expect(classifyCliError('HTTP 429; Retry-After: 60: rate limited')).toEqual({
      code: 'RATE_LIMITED',
      exitCode: CLI_EXIT_CODES.rateLimited,
      meta: { partial: false, rateLimit: { retryAfterSeconds: 60 } },
    });
    expect(classifyCliError('HTTP 500: expected timeline instructions')).toMatchObject({
      code: 'RUNTIME_ERROR',
      exitCode: CLI_EXIT_CODES.failure,
    });
  });

  it('emits partial data, cursor metadata, and exit code 5', () => {
    const ctx = createCliContext(['--json'], {}, false);
    const output: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((value?: unknown) => output.push(String(value)));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    try {
      expect(() =>
        ctx.failWithTweets(
          'HTTP 500: second page failed',
          {
            tweets: [{ id: '1', text: 'first page', author: { username: 'a', name: 'A' } }],
            nextCursor: 'cursor-2',
          },
          { usePagination: true },
        ),
      ).toThrow('exit 5');
      expect(JSON.parse(output[0] ?? '')).toMatchObject({
        ok: false,
        error: { code: 'PARTIAL_RESULT' },
        data: { tweets: [{ id: '1' }], nextCursor: 'cursor-2' },
        meta: { partial: true, nextCursor: 'cursor-2' },
      });
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it('wraps tweet-array JSON output', () => {
    const ctx = createCliContext(['--json'], {}, false);
    const output: string[] = [];
    const original = console.log;
    console.log = (value?: unknown) => output.push(String(value));
    try {
      ctx.printTweets([] as never[], { json: true });
    } finally {
      console.log = original;
    }

    expect(JSON.parse(output[0] ?? '')).toEqual({ ok: true, data: [], meta: { partial: false } });
  });

  it('returns JSON envelopes and dedicated exit codes from the installed command contract', () => {
    const dryRun = runCli(['--dry-run', 'tweet', 'hello']);
    expect(dryRun.status).toBe(0);
    expect(JSON.parse(dryRun.stdout)).toMatchObject({
      ok: true,
      data: { dryRun: true, action: 'tweet', text: 'hello' },
      meta: { partial: false },
    });

    const usage = runCli(['user-tweets', '@example', '--count', '0']);
    expect(usage.status).toBe(CLI_EXIT_CODES.usage);
    expect(JSON.parse(usage.stdout)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_USAGE' },
      meta: { partial: false },
    });

    const commanderUsage = runCli(['query-ids', '--unknown-option']);
    expect(commanderUsage.status).toBe(CLI_EXIT_CODES.usage);
    expect(JSON.parse(commanderUsage.stdout)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_USAGE' },
      meta: { partial: false },
    });

    const emptyHome = mkdtempSync(join(tmpdir(), 'xbird-contract-home-'));
    try {
      const auth = runCli(['check'], { HOME: emptyHome });
      expect(auth.status).toBe(CLI_EXIT_CODES.authentication);
      expect(JSON.parse(auth.stdout)).toMatchObject({
        ok: false,
        error: { code: 'AUTHENTICATION_REQUIRED' },
        meta: { partial: false },
      });
    } finally {
      rmSync(emptyHome, { recursive: true, force: true });
    }
  });
});
