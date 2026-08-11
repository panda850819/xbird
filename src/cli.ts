#!/usr/bin/env -S bun --no-env-file

/**
 * xbird - unofficial CLI for using X from the terminal
 *
 * Usage:
 *   xbird tweet "Hello world!"
 *   xbird reply <tweet-id> "This is a reply"
 *   xbird reply <tweet-url> "This is a reply"
 *   xbird read <tweet-id-or-url>
 */

import { CommanderError } from 'commander';
import { createProgram, KNOWN_COMMANDS } from './cli/program.js';
import { createCliContext } from './cli/shared.js';
import { resolveCliInvocation } from './lib/cli-args.js';

const rawArgs: string[] = process.argv.slice(2);
const normalizedArgs: string[] = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;

const ctx = createCliContext(normalizedArgs);

const program = createProgram(ctx);

const { argv, showHelp } = resolveCliInvocation(normalizedArgs, KNOWN_COMMANDS);

if (showHelp) {
  program.outputHelp();
  process.exit(0);
}

try {
  if (argv) {
    await program.parseAsync(argv);
  } else {
    await program.parseAsync(['bun', 'xbird', ...normalizedArgs]);
  }
} catch (error) {
  if (error instanceof CommanderError) {
    if (error.exitCode === 0) {
      process.exit(0);
    }
    if (ctx.isJson()) {
      ctx.fail(error.message, { code: 'INVALID_USAGE' });
    }
    process.exit(2);
  }
  throw error;
}
