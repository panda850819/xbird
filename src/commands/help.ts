import type { Command } from 'commander';
import type { CliContext } from '../cli/shared.js';

export function registerHelpCommand(program: Command, ctx: CliContext): void {
  program
    .command('help [command]')
    .description('Show help for a command')
    .action((commandName?: string) => {
      if (!commandName) {
        program.outputHelp();
        return;
      }

      const cmd = program.commands.find((c) => c.name() === commandName);
      if (!cmd) {
        console.error(`${ctx.p('err')}Unknown command: ${commandName}`);
        process.exitCode = 2;
        return;
      }

      cmd.outputHelp();
    });
}
