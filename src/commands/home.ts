import type { Command } from 'commander';
import type { CliContext } from '../cli/shared.js';
import { TwitterClient } from '../lib/twitter-client.js';

export function registerHomeCommand(program: Command, ctx: CliContext): void {
  program
    .command('home')
    .description('Get your home timeline ("For You" feed)')
    .option('-n, --count <number>', 'Number of tweets to fetch', '20')
    .option('--following', 'Get "Following" feed (chronological) instead of "For You"')
    .option('--json', 'Output as JSON')
    .option('--json-full', 'Output as JSON with full raw API response in _raw field')
    .action(async (cmdOpts: { count?: string; following?: boolean; json?: boolean; jsonFull?: boolean }) => {
      const opts = program.opts();
      const timeoutMs = ctx.resolveTimeoutFromOptions(opts);
      const count = Number.parseInt(cmdOpts.count || '20', 10);

      const { cookies, warnings } = await ctx.resolveCredentialsFromOptions(opts);

      for (const warning of warnings) {
        console.error(`${ctx.p('warn')}${warning}`);
      }

      if (!cookies.authToken || !cookies.ct0) {
        ctx.fail(`Missing required credentials`);
      }

      if (!Number.isFinite(count) || count <= 0) {
        ctx.fail(`Invalid --count. Expected a positive integer.`);
      }

      const client = new TwitterClient({ cookies, timeoutMs });
      const includeRaw = cmdOpts.jsonFull ?? false;

      const result = cmdOpts.following
        ? await client.getHomeLatestTimeline(count, { includeRaw })
        : await client.getHomeTimeline(count, { includeRaw });

      if (result.success) {
        const feedType = cmdOpts.following ? 'Following' : 'For You';
        const emptyMessage = `No tweets found in ${feedType} timeline.`;
        const isJson = Boolean(cmdOpts.json || cmdOpts.jsonFull);
        ctx.printTweets(result.tweets, { json: isJson, emptyMessage });
      } else {
        ctx.failWithTweets(`Failed to fetch home timeline: ${result.error}`, result, { usePagination: false });
      }
    });
}
