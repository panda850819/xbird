import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
};
const tempRoot = mkdtempSync(join(tmpdir(), 'xbird-package-smoke-'));
const packageDir = join(tempRoot, 'package');
const appDir = join(tempRoot, 'app');
const tarball = join(packageDir, 'xbird.tgz');

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

try {
  mkdirSync(packageDir);
  mkdirSync(appDir);
  writeFileSync(join(appDir, 'package.json'), '{"private":true,"type":"module"}\n');
  writeFileSync(join(appDir, '.env'), 'AUTH_TOKEN=must-not-be-loaded\nCT0=must-not-be-loaded\n');

  run(
    process.execPath,
    ['pm', 'pack', '--ignore-scripts', '--filename', tarball],
    root,
  );
  run(process.execPath, ['add', tarball], appDir);

  const bin = join(appDir, 'node_modules', '.bin', 'xbird');
  const safeEnv = {
    ...process.env,
    XBIRD_DISABLE_LIVE_WRITES: '1',
  };
  delete safeEnv.AUTH_TOKEN;
  delete safeEnv.CT0;
  delete safeEnv.TWITTER_AUTH_TOKEN;
  delete safeEnv.TWITTER_CT0;

  const version = run(bin, ['--version'], appDir, safeEnv).trim();
  if (version !== manifest.version) {
    throw new Error(`Installed CLI version mismatch: expected ${manifest.version}, got ${version}`);
  }

  const help = run(bin, ['--help'], appDir, safeEnv);
  if (!help.includes('Read, search, publish, and organize X posts')) {
    throw new Error('Installed CLI help is missing the package description');
  }

  const dryRun = run(bin, ['--plain', '--dry-run', 'tweet', 'package smoke'], appDir, safeEnv);
  if (!dryRun.includes('Dry run: would post tweet')) {
    throw new Error('Installed CLI dry-run failed');
  }

  const imported = run(
    process.execPath,
    [
      '--no-env-file',
      '-e',
      `import { TwitterClient } from ${JSON.stringify(manifest.name)}; console.log(typeof TwitterClient)`,
    ],
    appDir,
    safeEnv,
  ).trim();
  if (imported !== 'function') {
    throw new Error(`Installed library export failed: ${imported}`);
  }

  console.log(`Package smoke passed for ${manifest.name}@${manifest.version}`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
