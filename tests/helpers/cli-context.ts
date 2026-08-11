import type { CliErrorCode, CliResultMeta } from '../../src/lib/cli-contract.js';
import { exitCodeForError } from '../../src/lib/cli-contract.js';

export function failLikeCli<T = undefined>(
  message: string,
  options: { code?: CliErrorCode; data?: T; meta?: CliResultMeta } = {},
): never {
  console.error(message);
  process.exit(exitCodeForError(message, options.code));
}
