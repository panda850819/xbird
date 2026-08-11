import type { Command } from 'commander';
import type { CliContext, MediaSpec } from '../cli/shared.js';
import { stripLeadingAt, verifyExpectedAccount } from '../lib/account-safety.js';
import { formatTweetUrlLine } from '../lib/output.js';
import { TwitterClient } from '../lib/twitter-client.js';
import { checkMutationSafety } from '../lib/write-safety.js';

async function uploadMediaOrExit(
  client: TwitterClient,
  media: MediaSpec[],
  ctx: CliContext,
): Promise<string[] | undefined> {
  if (media.length === 0) {
    return undefined;
  }

  const uploaded: string[] = [];
  for (const item of media) {
    const res = await client.uploadMedia({ data: item.buffer, mimeType: item.mime, alt: item.alt });
    if (!res.success || !res.mediaId) {
      ctx.fail(`Media upload failed: ${res.error ?? 'Unknown error'}`);
    }
    uploaded.push(res.mediaId);
  }
  return uploaded;
}

function printDryRun(
  ctx: CliContext,
  action: { kind: 'tweet' } | { kind: 'reply'; tweetId: string },
  text: string,
  media: MediaSpec[],
  expectedUser?: string,
): void {
  if (ctx.isJson()) {
    ctx.printJson({
      dryRun: true,
      action: action.kind,
      ...(action.kind === 'reply' ? { tweetId: action.tweetId } : {}),
      text,
      media: media.map((item) => ({ path: item.path, mime: item.mime, alt: item.alt })),
      ...(expectedUser ? { expectedUser: stripLeadingAt(expectedUser) } : {}),
    });
    return;
  }
  const target = action.kind === 'tweet' ? 'post tweet' : `reply to ${action.tweetId}`;
  console.log(`${ctx.p('info')}Dry run: would ${target}`);
  console.log(`Text: ${text}`);
  for (const item of media) {
    console.log(`Media: ${item.path}${item.alt ? ` (alt: ${item.alt})` : ''}`);
  }
  if (expectedUser) {
    console.log(`Expected account: @${stripLeadingAt(expectedUser)}`);
  }
}

export function registerPostCommands(program: Command, ctx: CliContext): void {
  program
    .command('tweet')
    .description('Post a new tweet')
    .argument('<text>', 'Tweet text')
    .option('--json', 'Output as a stable JSON envelope')
    .action(async (text: string) => {
      const opts = program.opts();
      const safety = checkMutationSafety(opts);
      if (!safety.ok) {
        ctx.fail(`${safety.error}`);
      }
      const timeoutMs = ctx.resolveTimeoutFromOptions(opts);
      const quoteDepth = ctx.resolveQuoteDepthFromOptions(opts);
      let media: MediaSpec[] = [];
      try {
        media = ctx.loadMedia({ media: opts.media ?? [], alts: opts.alt ?? [] });
      } catch (error) {
        ctx.fail(`${error instanceof Error ? error.message : String(error)}`, { code: 'INVALID_USAGE' });
      }

      if (safety.dryRun) {
        printDryRun(ctx, { kind: 'tweet' }, text, media, opts.expectUser);
        return;
      }

      const { cookies, warnings } = await ctx.resolveCredentialsFromOptions(opts);

      for (const warning of warnings) {
        console.error(`${ctx.p('warn')}${warning}`);
      }

      if (!cookies.authToken || !cookies.ct0) {
        ctx.fail(`Missing required credentials`);
      }

      if (cookies.source) {
        console.error(`${ctx.l('source')}${cookies.source}`);
      }

      const client = new TwitterClient({ cookies, timeoutMs, quoteDepth });
      const account = await verifyExpectedAccount(client, opts.expectUser);
      if (!account.ok) {
        ctx.fail(`${account.error}`);
      }
      const mediaIds = await uploadMediaOrExit(client, media, ctx);
      const result = await client.tweet(text, mediaIds);

      if (result.success) {
        if (ctx.isJson()) {
          ctx.printJson({ action: 'tweet', tweetId: result.tweetId });
          return;
        }
        console.log(`${ctx.p('ok')}Tweet posted successfully!`);
        console.log(formatTweetUrlLine(result.tweetId, ctx.getOutput()));
      } else {
        ctx.fail(`Failed to post tweet: ${result.error}`);
      }
    });

  program
    .command('reply')
    .description('Reply to an existing tweet')
    .argument('<tweet-id-or-url>', 'Tweet ID or URL to reply to')
    .argument('<text>', 'Reply text')
    .option('--json', 'Output as a stable JSON envelope')
    .action(async (tweetIdOrUrl: string, text: string) => {
      const opts = program.opts();
      const safety = checkMutationSafety(opts);
      if (!safety.ok) {
        ctx.fail(`${safety.error}`);
      }
      const timeoutMs = ctx.resolveTimeoutFromOptions(opts);
      const quoteDepth = ctx.resolveQuoteDepthFromOptions(opts);
      let media: MediaSpec[] = [];
      try {
        media = ctx.loadMedia({ media: opts.media ?? [], alts: opts.alt ?? [] });
      } catch (error) {
        ctx.fail(`${error instanceof Error ? error.message : String(error)}`, { code: 'INVALID_USAGE' });
      }
      const tweetId = ctx.extractTweetId(tweetIdOrUrl);

      if (safety.dryRun) {
        printDryRun(ctx, { kind: 'reply', tweetId }, text, media, opts.expectUser);
        return;
      }

      const { cookies, warnings } = await ctx.resolveCredentialsFromOptions(opts);

      for (const warning of warnings) {
        console.error(`${ctx.p('warn')}${warning}`);
      }

      if (!cookies.authToken || !cookies.ct0) {
        ctx.fail(`Missing required credentials`);
      }

      if (cookies.source) {
        console.error(`${ctx.l('source')}${cookies.source}`);
      }

      console.error(`${ctx.p('info')}Replying to tweet: ${tweetId}`);

      const client = new TwitterClient({ cookies, timeoutMs, quoteDepth });
      const account = await verifyExpectedAccount(client, opts.expectUser);
      if (!account.ok) {
        ctx.fail(`${account.error}`);
      }
      const mediaIds = await uploadMediaOrExit(client, media, ctx);
      const result = await client.reply(text, tweetId, mediaIds);

      if (result.success) {
        if (ctx.isJson()) {
          ctx.printJson({ action: 'reply', tweetId: result.tweetId, inReplyToTweetId: tweetId });
          return;
        }
        console.log(`${ctx.p('ok')}Reply posted successfully!`);
        console.log(formatTweetUrlLine(result.tweetId, ctx.getOutput()));
      } else {
        ctx.fail(`Failed to post reply: ${result.error}`);
      }
    });
}
