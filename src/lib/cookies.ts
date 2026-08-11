/**
 * Browser cookie extraction for Twitter authentication.
 * Delegates to @steipete/sweet-cookie for Safari/Chrome/Firefox reads.
 */

import { type Cookie as BrowserCookie, getCookies } from '@steipete/sweet-cookie';

export interface TwitterCookies {
  authToken: string | null;
  ct0: string | null;
  cookieHeader: string | null;
  source: string | null;
  userId?: string | null;
}

export interface CookieExtractionResult {
  cookies: TwitterCookies;
  warnings: string[];
}

export type CookieSource = 'safari' | 'chrome' | 'arc' | 'firefox';

const TWITTER_COOKIE_NAMES = ['auth_token', 'ct0', 'twid'] as const;
const TWID_USER_ID_PATTERN = /^u=(\d+)$/;
const LEADING_DOT_PATTERN = /^\./;
const TWITTER_URL = 'https://x.com/';
const TWITTER_ORIGINS: string[] = ['https://x.com/', 'https://twitter.com/'];
const DEFAULT_COOKIE_TIMEOUT_MS = 30_000;

function normalizeValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cookieHeader(authToken: string, ct0: string, twid?: string | null): string {
  return `auth_token=${authToken}; ct0=${ct0}${twid ? `; twid=${twid}` : ''}`;
}

function userIdFromTwid(twid: string | null): string | null {
  if (!twid) {
    return null;
  }
  try {
    return decodeURIComponent(twid).match(TWID_USER_ID_PATTERN)?.[1] ?? null;
  } catch {
    return null;
  }
}

function buildEmpty(): TwitterCookies {
  return { authToken: null, ct0: null, cookieHeader: null, source: null };
}

function readEnvCookie(cookies: TwitterCookies, keys: readonly string[], field: 'authToken' | 'ct0'): void {
  if (cookies[field]) {
    return;
  }
  for (const key of keys) {
    const value = normalizeValue(process.env[key]);
    if (!value) {
      continue;
    }
    cookies[field] = value;
    if (!cookies.source) {
      cookies.source = `env ${key}`;
    }
    break;
  }
}

function resolveSources(cookieSource?: CookieSource | CookieSource[]): CookieSource[] {
  if (Array.isArray(cookieSource)) {
    return cookieSource;
  }
  if (cookieSource) {
    return [cookieSource];
  }
  return ['safari', 'chrome', 'firefox'];
}

function labelForSource(source: CookieSource, profile?: string): string {
  if (source === 'safari') {
    return 'Safari';
  }
  if (source === 'chrome' || source === 'arc') {
    const browser = source === 'arc' ? 'Arc' : 'Chrome';
    return profile ? `${browser} profile "${profile}"` : `${browser} default profile`;
  }
  return profile ? `Firefox profile "${profile}"` : 'Firefox default profile';
}

function selectCookieTuple(cookies: BrowserCookie[]): {
  tuple: { authToken: string; ct0: string; twid: string | null } | null;
  ambiguous: boolean;
} {
  const groups = new Map<
    string,
    {
      domain: string;
      values: Partial<Record<(typeof TWITTER_COOKIE_NAMES)[number], string>>;
    }
  >();

  for (const cookie of cookies) {
    const name = cookie.name as (typeof TWITTER_COOKIE_NAMES)[number];
    const value = normalizeValue(cookie.value);
    if (!TWITTER_COOKIE_NAMES.includes(name) || !value) {
      continue;
    }

    const domain = (cookie.domain ?? '').replace(LEADING_DOT_PATTERN, '').toLowerCase();
    const key = [domain, cookie.source?.browser, cookie.source?.profile, cookie.source?.storeId].join('|');
    const group = groups.get(key) ?? { domain, values: {} };
    if (group.values[name] && group.values[name] !== value) {
      return { tuple: null, ambiguous: true };
    }
    group.values[name] = value;
    groups.set(key, group);
  }

  const complete = [...groups.values()].filter((group) => group.values.auth_token && group.values.ct0);
  if (complete.length === 0) {
    return { tuple: null, ambiguous: false };
  }

  const first = complete[0].values;
  const hasDifferentCredentials = complete.some(
    ({ values }) => values.auth_token !== first.auth_token || values.ct0 !== first.ct0,
  );
  const candidates = complete.map((group) => ({
    group,
    userId: userIdFromTwid(group.values.twid ?? null),
  }));
  const userIds = new Set(candidates.flatMap(({ userId }) => (userId ? [userId] : [])));
  if (hasDifferentCredentials || userIds.size > 1) {
    return { tuple: null, ambiguous: true };
  }

  const selected =
    candidates.find(({ group, userId }) => group.domain === 'x.com' && userId) ??
    candidates.find(({ userId }) => userId) ??
    candidates.find(({ group }) => group.domain === 'x.com') ??
    candidates[0];
  const authToken = selected?.group.values.auth_token;
  const ct0 = selected?.group.values.ct0;
  if (!authToken || !ct0) {
    return { tuple: null, ambiguous: false };
  }

  return { tuple: { authToken, ct0, twid: selected.group.values.twid ?? null }, ambiguous: false };
}

async function readTwitterCookiesFromBrowser(options: {
  source: CookieSource;
  chromeProfile?: string;
  firefoxProfile?: string;
  cookieTimeoutMs?: number;
}): Promise<CookieExtractionResult> {
  const warnings: string[] = [];
  const out = buildEmpty();

  const isArc = options.source === 'arc';
  const { cookies, warnings: providerWarnings } = await getCookies({
    url: TWITTER_URL,
    origins: isArc ? [TWITTER_URL] : TWITTER_ORIGINS,
    names: [...TWITTER_COOKIE_NAMES],
    browsers: [options.source === 'arc' ? 'chrome' : options.source],
    chromiumBrowser: isArc ? 'arc' : undefined,
    mode: 'merge',
    chromeProfile: options.chromeProfile,
    firefoxProfile: options.firefoxProfile,
    timeoutMs: options.cookieTimeoutMs,
  });
  warnings.push(...providerWarnings);

  const selection = selectCookieTuple(cookies);
  if (selection.ambiguous) {
    warnings.push('Multiple complete Twitter cookie sets found; select a specific browser profile.');
  }
  if (selection.tuple) {
    out.authToken = selection.tuple.authToken;
    out.ct0 = selection.tuple.ct0;
    out.cookieHeader = cookieHeader(out.authToken, out.ct0, selection.tuple.twid);
    out.userId = userIdFromTwid(selection.tuple.twid);
    out.source = labelForSource(
      options.source,
      options.source === 'chrome' || options.source === 'arc' ? options.chromeProfile : options.firefoxProfile,
    );
    return { cookies: out, warnings };
  }

  if (options.source === 'safari') {
    warnings.push('No Twitter cookies found in Safari. Make sure you are logged into x.com in Safari.');
  } else if (options.source === 'chrome' || options.source === 'arc') {
    const browser = options.source === 'arc' ? 'Arc' : 'Chrome';
    warnings.push(`No Twitter cookies found in ${browser}. Make sure you are logged into x.com in ${browser}.`);
  } else {
    warnings.push(
      'No Twitter cookies found in Firefox. Make sure you are logged into x.com in Firefox and the profile exists.',
    );
  }

  return { cookies: out, warnings };
}

export async function extractCookiesFromSafari(): Promise<CookieExtractionResult> {
  return readTwitterCookiesFromBrowser({ source: 'safari' });
}

export async function extractCookiesFromChrome(profile?: string): Promise<CookieExtractionResult> {
  return readTwitterCookiesFromBrowser({ source: 'chrome', chromeProfile: profile });
}

export async function extractCookiesFromArc(profile?: string): Promise<CookieExtractionResult> {
  return readTwitterCookiesFromBrowser({ source: 'arc', chromeProfile: profile });
}

export async function extractCookiesFromFirefox(profile?: string): Promise<CookieExtractionResult> {
  return readTwitterCookiesFromBrowser({ source: 'firefox', firefoxProfile: profile });
}

/**
 * Resolve Twitter credentials from multiple sources.
 * Priority: CLI args > environment variables > browsers (ordered).
 */
export async function resolveCredentials(options: {
  authToken?: string;
  ct0?: string;
  cookieSource?: CookieSource | CookieSource[];
  chromeProfile?: string;
  firefoxProfile?: string;
  cookieTimeoutMs?: number;
}): Promise<CookieExtractionResult> {
  const warnings: string[] = [];
  const cookies = buildEmpty();
  const cookieTimeoutMs =
    typeof options.cookieTimeoutMs === 'number' &&
    Number.isFinite(options.cookieTimeoutMs) &&
    options.cookieTimeoutMs > 0
      ? options.cookieTimeoutMs
      : process.platform === 'darwin'
        ? DEFAULT_COOKIE_TIMEOUT_MS
        : undefined;

  if (options.authToken) {
    cookies.authToken = options.authToken;
    cookies.source = 'CLI argument';
  }
  if (options.ct0) {
    cookies.ct0 = options.ct0;
    if (!cookies.source) {
      cookies.source = 'CLI argument';
    }
  }

  readEnvCookie(cookies, ['AUTH_TOKEN', 'TWITTER_AUTH_TOKEN'], 'authToken');
  readEnvCookie(cookies, ['CT0', 'TWITTER_CT0'], 'ct0');

  if (cookies.authToken && cookies.ct0) {
    cookies.cookieHeader = cookieHeader(cookies.authToken, cookies.ct0);
    return { cookies, warnings };
  }

  const sourcesToTry = resolveSources(options.cookieSource);
  for (const source of sourcesToTry) {
    const res = await readTwitterCookiesFromBrowser({
      source,
      chromeProfile: options.chromeProfile,
      firefoxProfile: options.firefoxProfile,
      cookieTimeoutMs,
    });
    warnings.push(...res.warnings);
    if (res.cookies.authToken && res.cookies.ct0) {
      return { cookies: res.cookies, warnings };
    }
  }

  if (!cookies.authToken) {
    warnings.push(
      'Missing auth_token - provide via --auth-token, AUTH_TOKEN env var, or login to x.com in Safari/Chrome/Arc/Firefox',
    );
  }
  if (!cookies.ct0) {
    warnings.push('Missing ct0 - provide via --ct0, CT0 env var, or login to x.com in Safari/Chrome/Arc/Firefox');
  }
  if (cookies.authToken && cookies.ct0) {
    cookies.cookieHeader = cookieHeader(cookies.authToken, cookies.ct0);
  }

  return { cookies, warnings };
}
