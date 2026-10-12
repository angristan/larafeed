import {
    type CallToolResult,
    McpServer,
    requireScopes,
} from '@modelcontextprotocol/server';
import { ReaderFilter, ReaderOrder } from '@shared/schemas/reader';
import { Cause, Effect, Exit, Schema } from 'effect';

import { safeErrorClass, spanNames, traceAsync } from '../observability';
import type { ReaderService } from '../reader/service';
import type {
    SubscriptionRateLimited,
    SubscriptionStorageError,
} from '../subscriptions/errors';
import type { SubscriptionService } from '../subscriptions/service';
import { htmlToText } from './content';
import { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from './oauth';

export interface McpToolServices {
    readonly reader: ReaderService;
    readonly subscriptions: SubscriptionService;
    readonly limitFeedAdd: (
        userId: number,
    ) => Effect.Effect<
        void,
        SubscriptionRateLimited | SubscriptionStorageError
    >;
}

const SERVER_INFO = { name: 'larafeed', version: '1.0.0' } as const;

const INSTRUCTIONS = `Larafeed is the user's RSS and Atom feed reader.
Start with list_subscriptions to see categories, feeds, and unread counts.
Use list_entries to browse articles (unread by default) and get_entry to read one.
update_entries marks articles read, starred, or archived. Opening an article with get_entry does not mark it read.
subscribe and unsubscribe change the user's subscriptions. Confirm with the user before unsubscribing.`;

// Updating one entry's read, starred, and archived state can take 12 D1
// statements. 50 entries stay under D1's 1,000 queries per invocation, with
// room for the token and connection checks.
const MAX_ENTRY_IDS = 50;
const DEFAULT_PAGE_SIZE = 20;
const CURSOR_PATTERN = /^(\d{1,15}):(\d{1,15})$/u;

// Every write tool needs both scopes: the client steps up to `mcp:write` when
// the user granted read access only.
const writeScopes = requireScopes(MCP_READ_SCOPE, MCP_WRITE_SCOPE);

const SafeId = Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);

/**
 * Exposes an Effect schema to the MCP SDK, which validates tool arguments
 * through Standard Schema and publishes the JSON Schema form to clients.
 */
const toolInput = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) =>
    Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(schema));

const ListEntriesInput = toolInput(
    Schema.Struct({
        filter: Schema.optionalKey(ReaderFilter).annotate({
            description:
                'Which entries to return. Defaults to "unread". "favorites" means starred.',
        }),
        feedId: Schema.optionalKey(SafeId).annotate({
            description: 'Only entries from this feed.',
        }),
        categoryId: Schema.optionalKey(SafeId).annotate({
            description:
                'Only entries from feeds in this category. Do not combine with feedId.',
        }),
        orderBy: Schema.optionalKey(ReaderOrder).annotate({
            description:
                'Newest first by publication date (default) or by the time Larafeed fetched the entry.',
        }),
        cursor: Schema.optionalKey(Schema.String).annotate({
            description: 'nextCursor from a previous list_entries call.',
        }),
        limit: Schema.optionalKey(
            Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
        ).annotate({ description: 'Page size, 1 to 100. Defaults to 20.' }),
    }),
);

const GetEntryInput = toolInput(
    Schema.Struct({
        entryId: SafeId,
        format: Schema.optionalKey(Schema.Literals(['text', 'html'])).annotate({
            description:
                'Article body format. "text" (default) is plain text with link targets; "html" is the sanitized stored HTML.',
        }),
    }),
);

const UpdateEntriesInput = toolInput(
    Schema.Struct({
        entryIds: Schema.Array(SafeId)
            .check(Schema.isMinLength(1), Schema.isMaxLength(MAX_ENTRY_IDS))
            .annotate({ description: `1 to ${MAX_ENTRY_IDS} entry IDs.` }),
        read: Schema.optionalKey(Schema.Boolean),
        starred: Schema.optionalKey(Schema.Boolean),
        archived: Schema.optionalKey(Schema.Boolean),
    }),
);

const FeedInput = toolInput(Schema.Struct({ feedId: SafeId }));

const SubscribeInput = toolInput(
    Schema.Struct({
        url: Schema.String.check(
            Schema.isTrimmed(),
            Schema.isLengthBetween(1, 2_048),
        ).annotate({
            description:
                'A feed URL or a website URL. Larafeed discovers the feed on a website.',
        }),
        categoryId: Schema.optionalKey(SafeId).annotate({
            description: 'Existing category to file the feed under.',
        }),
        categoryName: Schema.optionalKey(
            Schema.String.check(
                Schema.isTrimmed(),
                Schema.isLengthBetween(1, 255),
            ),
        ).annotate({
            description:
                'Name of a new category to create for the feed. Pass exactly one of categoryId or categoryName.',
        }),
    }),
);

const iso = (timestamp: number | null): string | null =>
    timestamp === null ? null : new Date(timestamp).toISOString();

const textResult = (value: unknown): CallToolResult => ({
    content: [
        {
            type: 'text',
            text: typeof value === 'string' ? value : JSON.stringify(value),
        },
    ],
});

const errorResult = (message: string): CallToolResult => ({
    isError: true,
    content: [{ type: 'text', text: message }],
});

class ToolInputError extends Schema.TaggedError<ToolInputError>()(
    'ToolInputError',
    { message: Schema.String },
) {}

const errorTag = (error: unknown): string | undefined => {
    if (typeof error !== 'object' || error === null) return undefined;
    const tag = Reflect.get(error, '_tag');
    return typeof tag === 'string' ? tag : undefined;
};

const feedErrorMessages: Readonly<Record<string, string>> = {
    invalid_url: 'The URL is not a valid public http(s) URL.',
    unresolvable_host: 'The website host name does not resolve.',
    unsupported_feed: 'No RSS, Atom, RDF, or JSON feed was found at that URL.',
    feed_too_large: 'The feed is too large to import.',
    upstream_rate_limited:
        'The website is rate limiting Larafeed. Try again later.',
    temporarily_unavailable:
        'The website did not respond correctly. Try again later.',
};

/**
 * Turns a failure into a message the model can act on. Returns undefined for
 * unexpected failures, which are logged and reported generically.
 */
const expectedFailureMessage = (error: unknown): string | undefined => {
    switch (errorTag(error)) {
        case 'ToolInputError':
            return (error as ToolInputError).message;
        case 'ReaderNotFound':
        case 'SubscriptionNotFound':
            return 'Not found. The entry or feed does not exist in this account.';
        case 'ReaderValidationError':
        case 'SubscriptionValidationError':
            return 'Invalid arguments.';
        case 'SubscriptionConflict':
            return `Conflict: ${String(Reflect.get(error as object, 'reason'))}.`;
        case 'SubscriptionFeedError':
            return (
                feedErrorMessages[
                    String(Reflect.get(error as object, 'reason'))
                ] ?? 'The feed could not be added.'
            );
        case 'SubscriptionRateLimited':
            return 'Too many subscription attempts. Try again in a minute.';
        case 'ReaderStorageError':
        case 'SubscriptionStorageError':
            return 'Larafeed is temporarily unavailable. Try again.';
        default:
            return undefined;
    }
};

/**
 * Runs one tool call inside an `app.mcp.tool.call` span. Expected failures
 * become tool errors (`isError: true`) so the model can recover; anything else
 * is logged without arguments, which can contain private reading data.
 */
const runTool = (
    tool: string,
    program: Effect.Effect<CallToolResult, unknown>,
): Promise<CallToolResult> =>
    traceAsync(
        spanNames.mcpToolCall,
        { 'app.mcp.tool': tool },
        async (span) => {
            const exit = await Effect.runPromiseExit(program);
            if (Exit.isSuccess(exit)) return exit.value;

            const error = Cause.squash(exit.cause);
            const errorClass = safeErrorClass(error);
            span.setAttribute('app.mcp.tool.error', errorClass);
            const message = expectedFailureMessage(error);
            if (message !== undefined) return errorResult(message);

            console.error({
                event: 'mcp.tool.failed',
                tool,
                errorClass,
            });
            return errorResult('Larafeed hit an unexpected error. Try again.');
        },
    );

const parseCursor = (
    value: string | undefined,
): Effect.Effect<{ orderValue: number; id: number } | null, ToolInputError> => {
    if (value === undefined) return Effect.succeed(null);
    const match = CURSOR_PATTERN.exec(value);
    if (match === null) {
        return Effect.fail(
            new ToolInputError({
                message: 'Invalid cursor. Pass nextCursor exactly as returned.',
            }),
        );
    }
    return Effect.succeed({
        orderValue: Number(match[1]),
        id: Number(match[2]),
    });
};

export const makeMcpServer = (
    services: McpToolServices,
    userId: number,
): McpServer => {
    const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
    const { reader, subscriptions } = services;

    server.registerTool(
        'list_subscriptions',
        {
            title: 'List subscriptions',
            description:
                'Lists categories with their subscribed feeds and unread counts, plus account-wide totals.',
            annotations: { readOnlyHint: true, openWorldHint: false },
        },
        () =>
            runTool(
                'list_subscriptions',
                Effect.gen(function* () {
                    const [counts, categories, feeds] = yield* Effect.all([
                        reader.getCounts(userId),
                        reader.listCategories(userId),
                        reader.listSubscriptions(userId),
                    ]);
                    return textResult({
                        counts: {
                            unread: counts.unread,
                            starred: counts.starred,
                            total: counts.total,
                        },
                        categories: categories.categories.map((category) => ({
                            id: category.id,
                            name: category.name,
                            feeds: feeds.subscriptions
                                .filter(
                                    (feed) => feed.categoryId === category.id,
                                )
                                .map((feed) => ({
                                    feedId: feed.feedId,
                                    name: feed.customFeedName ?? feed.feedName,
                                    unread: feed.unreadCount,
                                    total: feed.totalCount,
                                })),
                        })),
                    });
                }),
            ),
    );

    server.registerTool(
        'list_entries',
        {
            title: 'List entries',
            description:
                'Lists feed entries, newest first, without their content. Use get_entry to read one.',
            inputSchema: ListEntriesInput,
            annotations: { readOnlyHint: true, openWorldHint: false },
        },
        (input) =>
            runTool(
                'list_entries',
                Effect.gen(function* () {
                    if (
                        input.feedId !== undefined &&
                        input.categoryId !== undefined
                    ) {
                        return yield* new ToolInputError({
                            message: 'Pass feedId or categoryId, not both.',
                        });
                    }
                    const page = yield* reader.listEntries(userId, {
                        scope:
                            input.feedId !== undefined
                                ? { type: 'feed', id: input.feedId }
                                : input.categoryId !== undefined
                                  ? { type: 'category', id: input.categoryId }
                                  : { type: 'all' },
                        filter: input.filter ?? 'unread',
                        orderBy: input.orderBy ?? 'published_at',
                        cursor: yield* parseCursor(input.cursor),
                        pageSize: input.limit ?? DEFAULT_PAGE_SIZE,
                    });
                    return textResult({
                        total: page.total,
                        nextCursor: page.nextCursor,
                        entries: page.entries.map((entry) => ({
                            id: entry.id,
                            title: entry.title,
                            url: entry.url,
                            author: entry.author,
                            feedId: entry.feedId,
                            feed: entry.customFeedName ?? entry.feedName,
                            publishedAt: iso(entry.publishedAt),
                            read: entry.read,
                            starred: entry.starred,
                            archived: entry.archived,
                        })),
                    });
                }),
            ),
    );

    server.registerTool(
        'get_entry',
        {
            title: 'Read entry',
            description:
                'Returns one entry with its full stored content. It does not mark the entry read.',
            inputSchema: GetEntryInput,
            annotations: { readOnlyHint: true, openWorldHint: false },
        },
        (input) =>
            runTool(
                'get_entry',
                Effect.gen(function* () {
                    const entry = yield* reader.findEntry(
                        userId,
                        input.entryId,
                    );
                    const html = entry.contentHtml ?? '';
                    const body =
                        input.format === 'html'
                            ? html
                            : yield* Effect.promise(() => htmlToText(html));
                    const status = [
                        entry.read ? 'read' : 'unread',
                        ...(entry.starred ? ['starred'] : []),
                        ...(entry.archived ? ['archived'] : []),
                    ].join(', ');
                    return textResult(
                        [
                            `# ${entry.title || '(untitled)'}`,
                            '',
                            `Entry ID: ${entry.id}`,
                            `Feed: ${entry.customFeedName ?? entry.feedName} (feed ID ${entry.feedId})`,
                            ...(entry.author === null
                                ? []
                                : [`Author: ${entry.author}`]),
                            `Published: ${iso(entry.publishedAt)}`,
                            ...(entry.url === null
                                ? []
                                : [`URL: ${entry.url}`]),
                            `Status: ${status}`,
                            '',
                            '---',
                            '',
                            body.length > 0
                                ? body
                                : '(This entry has no stored content. Open the URL to read it.)',
                        ].join('\n'),
                    );
                }),
            ),
    );

    server.registerTool(
        'update_entries',
        {
            title: 'Update entries',
            description:
                'Marks entries read or unread, starred or unstarred, and archived or unarchived. Set at least one of read, starred, or archived.',
            inputSchema: UpdateEntriesInput,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            scopeChallenge: writeScopes,
        },
        (input) =>
            runTool(
                'update_entries',
                Effect.gen(function* () {
                    if (
                        input.read === undefined &&
                        input.starred === undefined &&
                        input.archived === undefined
                    ) {
                        return yield* new ToolInputError({
                            message:
                                'Set at least one of read, starred, or archived.',
                        });
                    }
                    const updated: unknown[] = [];
                    const notFound: number[] = [];
                    // Sequential on purpose: each change is a small D1 batch.
                    for (const entryId of new Set(input.entryIds)) {
                        const result = yield* Effect.gen(function* () {
                            let state:
                                | Effect.Success<
                                      ReturnType<ReaderService['setRead']>
                                  >
                                | undefined;
                            if (input.read !== undefined) {
                                state = yield* reader.setRead(
                                    userId,
                                    entryId,
                                    input.read,
                                );
                            }
                            if (input.starred !== undefined) {
                                state = yield* reader.setStarred(
                                    userId,
                                    entryId,
                                    input.starred,
                                );
                            }
                            if (input.archived !== undefined) {
                                state = yield* reader.setArchived(
                                    userId,
                                    entryId,
                                    input.archived,
                                );
                            }
                            return state;
                        }).pipe(
                            Effect.catchTag('ReaderNotFound', () =>
                                Effect.succeed(null),
                            ),
                        );
                        if (result === null || result === undefined) {
                            notFound.push(entryId);
                        } else {
                            updated.push({
                                id: result.entryId,
                                read: result.read,
                                starred: result.starred,
                                archived: result.archived,
                            });
                        }
                    }
                    return textResult({ updated, notFound });
                }),
            ),
    );

    server.registerTool(
        'mark_feed_read',
        {
            title: 'Mark feed read',
            description:
                'Marks every entry currently in one subscribed feed as read.',
            inputSchema: FeedInput,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            scopeChallenge: writeScopes,
        },
        (input) =>
            runTool(
                'mark_feed_read',
                reader
                    .advanceReadThrough(userId, input.feedId)
                    .pipe(
                        Effect.map((result) =>
                            textResult({ feedId: result.feedId, read: true }),
                        ),
                    ),
            ),
    );

    server.registerTool(
        'subscribe',
        {
            title: 'Subscribe to a feed',
            description:
                'Subscribes to a feed by feed or website URL. When a website offers several feeds, returns the choices; call subscribe again with one feedUrl.',
            inputSchema: SubscribeInput,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                // Larafeed fetches the URL to discover the feed.
                openWorldHint: true,
            },
            scopeChallenge: writeScopes,
        },
        (input) =>
            runTool(
                'subscribe',
                Effect.gen(function* () {
                    if (
                        (input.categoryId === undefined) ===
                        (input.categoryName === undefined)
                    ) {
                        return yield* new ToolInputError({
                            message:
                                'Pass exactly one of categoryId (existing) or categoryName (new). list_subscriptions shows category IDs.',
                        });
                    }
                    yield* services.limitFeedAdd(userId);
                    const result = yield* subscriptions.createSubscription(
                        userId,
                        {
                            feedUrl: input.url,
                            ...(input.categoryId === undefined
                                ? {}
                                : { categoryId: input.categoryId }),
                            ...(input.categoryName === undefined
                                ? {}
                                : { categoryName: input.categoryName }),
                        },
                    );
                    if (result.kind === 'selection_required') {
                        return textResult({
                            status: 'choose_feed',
                            message:
                                'This website offers several feeds. Ask the user which one to follow, then call subscribe with its feedUrl.',
                            candidates: result.candidates.map((candidate) => ({
                                title: candidate.title,
                                feedUrl: candidate.feedUrl,
                                siteUrl: candidate.siteUrl,
                            })),
                        });
                    }
                    const subscription = result.subscription;
                    return textResult({
                        status: result.createdSubscription
                            ? 'subscribed'
                            : 'already_subscribed',
                        feedId: subscription.feedId,
                        name:
                            subscription.customFeedName ??
                            subscription.feedName,
                        feedUrl: subscription.feedUrl,
                        categoryId: subscription.categoryId,
                        category: subscription.categoryName,
                        entries: subscription.entryCount,
                    });
                }),
            ),
    );

    server.registerTool(
        'unsubscribe',
        {
            title: 'Unsubscribe from a feed',
            description:
                "Removes a feed from the user's subscriptions, with its read and starred state. Confirm with the user first.",
            inputSchema: FeedInput,
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
            scopeChallenge: writeScopes,
        },
        (input) =>
            runTool(
                'unsubscribe',
                subscriptions.unsubscribe(userId, input.feedId).pipe(
                    Effect.as(
                        textResult({
                            feedId: input.feedId,
                            unsubscribed: true,
                        }),
                    ),
                ),
            ),
    );

    return server;
};
