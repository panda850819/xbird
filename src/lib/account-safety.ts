import type { CurrentUserResult } from './twitter-client-types.js';

const LEADING_AT_PATTERN = /^@/;

export interface CurrentUserReader {
  getCurrentUser(): Promise<CurrentUserResult>;
}

export type ExpectedAccountResult =
  | { ok: true; username?: string }
  | { ok: false; error: string; actualUsername?: string };

export function stripLeadingAt(value: string): string {
  return value.trim().replace(LEADING_AT_PATTERN, '');
}

export function normalizeUsername(value: string): string {
  return stripLeadingAt(value).toLowerCase();
}

export async function verifyExpectedAccount(
  client: CurrentUserReader,
  expectedUser: string | undefined,
): Promise<ExpectedAccountResult> {
  if (!expectedUser) {
    return { ok: true };
  }

  const expected = normalizeUsername(expectedUser);
  if (!expected) {
    return { ok: false, error: '--expect-user requires a non-empty X username' };
  }

  const result = await client.getCurrentUser();
  if (!result.success || !result.user) {
    return {
      ok: false,
      error: `Could not verify the authenticated account: ${result.error ?? 'Unknown error'}`,
    };
  }

  const actual = normalizeUsername(result.user.username);
  if (actual !== expected) {
    return {
      ok: false,
      error: `Authenticated account @${result.user.username} does not match --expect-user @${expected}`,
      actualUsername: result.user.username,
    };
  }

  return { ok: true, username: result.user.username };
}
