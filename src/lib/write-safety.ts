const TRUTHY_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function areLiveWritesDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return TRUTHY_ENV_VALUES.has((env.XBIRD_DISABLE_LIVE_WRITES ?? '').trim().toLowerCase());
}

export type MutationSafetyResult = { ok: true; dryRun: boolean } | { ok: false; error: string };

export function checkMutationSafety(
  options: { dryRun?: boolean },
  env: NodeJS.ProcessEnv = process.env,
): MutationSafetyResult {
  if (options.dryRun) {
    return { ok: true, dryRun: true };
  }
  if (areLiveWritesDisabled(env)) {
    return {
      ok: false,
      error: 'Live writes are disabled by XBIRD_DISABLE_LIVE_WRITES. Use --dry-run to preview safely.',
    };
  }
  return { ok: true, dryRun: false };
}
