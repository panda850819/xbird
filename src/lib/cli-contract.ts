export const CLI_EXIT_CODES = {
  success: 0,
  failure: 1,
  usage: 2,
  authentication: 3,
  unavailable: 4,
  partial: 5,
  rateLimited: 6,
} as const;

export type CliErrorCode =
  | 'RUNTIME_ERROR'
  | 'INVALID_USAGE'
  | 'AUTHENTICATION_REQUIRED'
  | 'CAPABILITY_UNAVAILABLE'
  | 'PARTIAL_RESULT'
  | 'RATE_LIMITED';

export type CliResultMeta = {
  nextCursor?: string | null;
  partial?: boolean;
  pagesFetched?: number;
  rateLimit?: {
    retryAfterSeconds?: number;
  };
};

export type CliSuccessEnvelope<T> = {
  ok: true;
  data: T;
  meta: CliResultMeta;
};

export type CliErrorEnvelope<T = undefined> = {
  ok: false;
  error: {
    code: CliErrorCode;
    message: string;
  };
  data?: T;
  meta: CliResultMeta;
};

const HTTP_STATUS_PATTERN = /(?:HTTP\s+|status(?:\s+code)?[=: ]+)(\d{3})/i;
const RETRY_AFTER_PATTERN = /retry-after(?:\s*[:=]\s*|\s+)(\d+)/i;
const AUTH_PATTERN = /(?:missing required credentials|auth(?:entication|orization)?|unauthorized|forbidden|login)/i;
const UNAVAILABLE_PATTERN = /(?:not supported|capability unavailable|endpoint unavailable)/i;
const USAGE_PATTERN = /(?:^invalid\b|^--[\w-]+\s+(?:requires?|must)\b|\brequires?\s+--)/i;
const RATE_LIMIT_PATTERN = /(?:rate.?limit|too many requests|overcapacity)/i;

export function createSuccessEnvelope<T>(data: T, meta: CliResultMeta = {}): CliSuccessEnvelope<T> {
  return { ok: true, data, meta: { partial: false, ...meta } };
}

export function classifyCliError(message: string): {
  code: CliErrorCode;
  exitCode: number;
  meta: CliResultMeta;
} {
  const status = Number.parseInt(HTTP_STATUS_PATTERN.exec(message)?.[1] ?? '', 10);
  const retryAfter = Number.parseInt(RETRY_AFTER_PATTERN.exec(message)?.[1] ?? '', 10);
  if (status === 429 || RATE_LIMIT_PATTERN.test(message)) {
    return {
      code: 'RATE_LIMITED',
      exitCode: CLI_EXIT_CODES.rateLimited,
      meta: {
        partial: false,
        rateLimit: Number.isFinite(retryAfter) ? { retryAfterSeconds: retryAfter } : {},
      },
    };
  }
  if (status === 401 || status === 403 || AUTH_PATTERN.test(message)) {
    return { code: 'AUTHENTICATION_REQUIRED', exitCode: CLI_EXIT_CODES.authentication, meta: { partial: false } };
  }
  if (USAGE_PATTERN.test(message)) {
    return { code: 'INVALID_USAGE', exitCode: CLI_EXIT_CODES.usage, meta: { partial: false } };
  }
  if (UNAVAILABLE_PATTERN.test(message)) {
    return { code: 'CAPABILITY_UNAVAILABLE', exitCode: CLI_EXIT_CODES.unavailable, meta: { partial: false } };
  }
  return { code: 'RUNTIME_ERROR', exitCode: CLI_EXIT_CODES.failure, meta: { partial: false } };
}

export function createErrorEnvelope<T = undefined>(
  message: string,
  options: {
    code?: CliErrorCode;
    data?: T;
    meta?: CliResultMeta;
  } = {},
): CliErrorEnvelope<T> {
  const classified = classifyCliError(message);
  const code = options.code ?? classified.code;
  const partial = code === 'PARTIAL_RESULT';
  return {
    ok: false,
    error: { code, message },
    ...(options.data === undefined ? {} : { data: options.data }),
    meta: { ...classified.meta, partial, ...options.meta },
  };
}

export function exitCodeForError(message: string, code?: CliErrorCode): number {
  if (code === 'INVALID_USAGE') {
    return CLI_EXIT_CODES.usage;
  }
  if (code === 'AUTHENTICATION_REQUIRED') {
    return CLI_EXIT_CODES.authentication;
  }
  if (code === 'CAPABILITY_UNAVAILABLE') {
    return CLI_EXIT_CODES.unavailable;
  }
  if (code === 'PARTIAL_RESULT') {
    return CLI_EXIT_CODES.partial;
  }
  if (code === 'RATE_LIMITED') {
    return CLI_EXIT_CODES.rateLimited;
  }
  return classifyCliError(message).exitCode;
}
