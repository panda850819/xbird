import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const cliPath = join(import.meta.dirname, '..', 'src', 'cli.ts');
const tempPaths: string[] = [];

afterEach(() => {
  for (const path of tempPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe('CLI environment isolation', () => {
  it('does not automatically load credentials from the working directory .env', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'xbird-no-env-'));
    tempPaths.push(cwd);
    writeFileSync(join(cwd, '.env'), 'AUTH_TOKEN=dotenv-auth-secret\nCT0=dotenv-ct0-secret\n');

    const env = { ...process.env, HOME: cwd, NO_COLOR: '1' };
    delete env.AUTH_TOKEN;
    delete env.CT0;
    delete env.TWITTER_AUTH_TOKEN;
    delete env.TWITTER_CT0;

    const result = spawnSync(
      cliPath,
      ['--plain', '--cookie-source', 'firefox', '--firefox-profile', 'xbird-missing-profile', 'check'],
      { cwd, encoding: 'utf8', env },
    );

    expect(result.status).toBe(3);
    expect(result.stdout).toContain('auth_token: not found');
    expect(result.stdout).toContain('ct0: not found');
    expect(result.stdout).not.toContain('dotenv-auth-secret');
    expect(result.stdout).not.toContain('dotenv-ct0-secret');
  });
});
