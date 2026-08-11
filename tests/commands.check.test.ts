import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

function runCheck() {
  return spawnSync('bun', ['src/cli.ts', '--plain', 'check'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      AUTH_TOKEN: 'secret-auth-token-value',
      CT0: 'secret-ct0-value',
      NO_COLOR: '1',
    },
  });
}

describe('check command', () => {
  it('reports credential presence without revealing credential fragments', () => {
    const result = runCheck();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('auth_token: present');
    expect(result.stdout).toContain('ct0: present');
    expect(result.stdout).not.toContain('secret-auth');
    expect(result.stdout).not.toContain('secret-ct0');
    expect(result.stderr).not.toContain('secret-auth');
    expect(result.stderr).not.toContain('secret-ct0');
  });
});
