import type { Command } from 'commander';
import type { CliContext } from '../cli/shared.js';
import { stripLeadingAt, verifyExpectedAccount } from '../lib/account-safety.js';
import { TwitterClient } from '../lib/twitter-client.js';
import { checkMutationSafety } from '../lib/write-safety.js';

export function registerUnbookmarkCommand(program: Command, ctx: CliContext): void {
  program
    .command('unbookmark')
    .description('Remove bookmarked tweets')
    .argument('<tweet-id-or-url...>', 'Tweet IDs or URLs to remove from bookmarks')
    .option('--json', 'Output as a stable JSON envelope')
    .action(async (tweetIdOrUrls: string[]) => {
      const opts = program.opts();
      const safety = checkMutationSafety(opts);
      if (!safety.ok) {
        ctx.fail(safety.error);
      }
      const tweetIds = tweetIdOrUrls.map((input) => ctx.extractTweetId(input));
      if (safety.dryRun) {
        if (ctx.isJson()) {
          ctx.printJson({
            dryRun: true,
            action: 'unbookmark',
            tweetIds,
            ...(opts.expectUser ? { expectedUser: stripLeadingAt(String(opts.expectUser)) } : {}),
          });
          return;
        }
        for (const tweetId of tweetIds) {
          console.log(`${ctx.p('info')}Dry run: would remove bookmark for ${tweetId}`);
        }
        if (opts.expectUser) {
          console.log(`Expected account: @${stripLeadingAt(String(opts.expectUser))}`);
        }
        return;
      }
      const timeoutMs = ctx.resolveTimeoutFromOptions(opts);

      const { cookies, warnings } = await ctx.resolveCredentialsFromOptions(opts);

      for (const warning of warnings) {
        console.error(`${ctx.p('warn')}${warning}`);
      }

      if (!cookies.authToken || !cookies.ct0) {
        ctx.fail('Missing required credentials', { code: 'AUTHENTICATION_REQUIRED' });
      }

      const client = new TwitterClient({ cookies, timeoutMs });
      const account = await verifyExpectedAccount(client, opts.expectUser);
      if (!account.ok) {
        ctx.fail(account.error, { code: 'AUTHENTICATION_REQUIRED' });
      }
      const removed: string[] = [];
      const failed: Array<{ tweetId: string; error: string }> = [];

      for (const tweetId of tweetIds) {
        const result = await client.unbookmark(tweetId);
        if (result.success) {
          removed.push(tweetId);
          if (!ctx.isJson()) {
            console.log(`${ctx.p('ok')}Removed bookmark for ${tweetId}`);
          }
        } else {
          failed.push({ tweetId, error: result.error ?? 'Unknown error' });
          if (!ctx.isJson()) {
            console.error(`${ctx.p('err')}Failed to remove bookmark for ${tweetId}: ${result.error}`);
          }
        }
      }

      if (failed.length > 0) {
        ctx.fail('One or more bookmarks could not be removed', {
          code: removed.length > 0 ? 'PARTIAL_RESULT' : undefined,
          data: { removed, failed },
          meta: { partial: removed.length > 0 },
        });
      }
      if (ctx.isJson()) {
        ctx.printJson({ action: 'unbookmark', removed });
      }
    });
}
