#!/usr/bin/env bun

/**
 * xbird - unofficial CLI for using X from the terminal
 *
 * Usage:
 *   xbird tweet "Hello world!"
 *   xbird reply <tweet-id> "This is a reply"
 *   xbird reply <tweet-url> "This is a reply"
 *   xbird read <tweet-id-or-url>
 */

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

if (argv) {
  program.parse(argv);
} else {
  program.parse(['bun', 'xbird', ...normalizedArgs]);
}
