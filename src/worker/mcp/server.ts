import {
    type CallToolResult,
    McpServer,
    requireScopes,
} from '@modelcontextprotocol/server';
import { ReaderFilter, ReaderOrder } from '@shared/schemas/reader';
import { Cause, Effect, Exit, Schema } from 'effect';

import { safeErrorClass, spanNames, traceAsync } from '../observability';
import type { ReaderEntryScope } from '../reader/repository';
import type { ReaderService } from '../reader/service';
import { SearchQueryError, toFtsQuery } from '../search/query';
import type {
    SubscriptionRateLimited,
    SubscriptionStorageError,
} from '../subscriptions/errors';
import type { SubscriptionService } from '../subscriptions/service';
import {
    buildExcerpts,
    type EntryContentServices,
    loadEntry,
    renderEntry,
} from './entries';
import { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from './oauth';

export interface McpToolServices extends EntryContentServices {
    readonly subscriptions: SubscriptionService;
    /** Start of each owned entry's stored HTML, keyed by entry ID. */
    readonly contentPrefixes: (
        userId: number,
        entryIds: readonly number[],
        maxChars: number,
    ) => Effect.Effect<ReadonlyMap<number, string>, unknown>;
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
Use list_entries to browse articles (unread by default) and search_entries to find articles by words in their title, author, or text. Each entry includes a short excerpt; use since and until for date ranges.
Read articles with get_entries (several at once) or get_entry (one, with a larger size limit). Many feeds only carry a teaser: pass fullContent: true to fetch the article from the website.
Reading an article does not mark it read. update_entries marks articles read, starred, or archived.
feed_health lists feeds that fail to refresh.
subscribe and unsubscribe change the user's subscriptions. Confirm with the user before unsubscribing.`;

// Updating one entry's read, starred, and archived state can take 12 D1
// statements. 50 entries stay under D1's 1,000 queries per invocation, with
// room for the token and connection checks.
const MAX_ENTRY_IDS = 50;
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_EXCERPT_CHARS = 200;
const MAX_EXCERPT_CHARS = 1_000;
const DEFAULT_ENTRY_CHARS = 20_000;
const DEFAULT_BATCH_ENTRY_CHARS = 4_000;
// get_entries returns up to 20 bodies of up to 20,000 characters each, so
// one call stays below about 400 KB of text.
const MAX_BATCH_ENTRIES = 20;
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
        since: Schema.optionalKey(Schema.String).annotate({
            description:
                'Only entries at or after this time, compared with orderBy. ISO 8601 date or date-time, e.g. 2026-10-12 or 2026-10-12T08:00:00Z. Times without a zone are UTC.',
        }),
        until: Schema.optionalKey(Schema.String).annotate({
            description:
                'Only entries before this time, compared with orderBy. Same format as since.',
        }),
        excerptChars: Schema.optionalKey(
            Schema.Int.check(
                Schema.isBetween({ minimum: 0, maximum: MAX_EXCERPT_CHARS }),
            ),
        ).annotate({
            description: `Length of the plain-text excerpt per entry, 0 to ${MAX_EXCERPT_CHARS}. Defaults to ${DEFAULT_EXCERPT_CHARS}; 0 omits excerpts.`,
        }),
    }),
);

const EntryFormat = Schema.optionalKey(
    Schema.Literals(['text', 'html']),
).annotate({
    description:
        'Article body format. "text" (default) is plain text with link targets; "html" is sanitized HTML.',
});

const FullContentFlag = Schema.optionalKey(Schema.Boolean).annotate({
    description:
        'Fetch the full article from the website instead of the feed content. Use it when the feed only has a teaser. Falls back to the feed content, with the reason, when the fetch fails.',
});

const maxCharsField = (defaultChars: number) =>
    Schema.optionalKey(
        Schema.Int.check(Schema.isBetween({ minimum: 500, maximum: 100_000 })),
    ).annotate({
        description: `Maximum characters of article body, 500 to 100000. Defaults to ${defaultChars}. Longer bodies are cut and marked truncated.`,
    });

const GetEntryInput = toolInput(
    Schema.Struct({
        entryId: SafeId,
        format: EntryFormat,
        fullContent: FullContentFlag,
        maxChars: maxCharsField(DEFAULT_ENTRY_CHARS),
    }),
);

const GetEntriesInput = toolInput(
    Schema.Struct({
        entryIds: Schema.Array(SafeId)
            .check(Schema.isMinLength(1), Schema.isMaxLength(MAX_BATCH_ENTRIES))
            .annotate({ description: `1 to ${MAX_BATCH_ENTRIES} entry IDs.` }),
        format: EntryFormat,
        fullContent: FullContentFlag,
        maxChars: Schema.optionalKey(
            Schema.Int.check(
                Schema.isBetween({ minimum: 500, maximum: 20_000 }),
            ),
        ).annotate({
            description: `Maximum characters of body per entry, 500 to 20000. Defaults to ${DEFAULT_BATCH_ENTRY_CHARS}.`,
        }),
    }),
);

const SearchEntriesInput = toolInput(
    Schema.Struct({
        query: Schema.String.check(Schema.isLengthBetween(1, 500)).annotate({
            description:
                'Words to find. All words must match. Use "quotes" for a phrase, word* for a prefix, OR between alternatives, and -word to exclude. Case and accents are ignored.',
        }),
        filter: Schema.optionalKey(ReaderFilter).annotate({
            description:
                'Which entries to search. Defaults to "all". "favorites" means starred.',
        }),
        feedId: Schema.optionalKey(SafeId),
        categoryId: Schema.optionalKey(SafeId),
        since: Schema.optionalKey(Schema.String).annotate({
            description:
                'Only entries published at or after this time. ISO 8601 date or date-time.',
        }),
        until: Schema.optionalKey(Schema.String).annotate({
            description: 'Only entries published before this time.',
        }),
        limit: Schema.optionalKey(
            Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 })),
        ).annotate({
            description: 'Results per page, 1 to 50. Defaults to 10.',
        }),
        offset: Schema.optionalKey(
            Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 500 })),
        ).annotate({
            description:
                'Results to skip; pass nextOffset from the previous page.',
        }),
    }),
);

const FeedHealthInput = toolInput(
    Schema.Struct({
        onlyProblems: Schema.optionalKey(Schema.Boolean).annotate({
            description:
                'Only feeds that are failing or gone. Defaults to true; false lists every feed.',
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

/**
 * A result for clients that read text and for clients that read typed
 * `structuredContent`. MCP asks servers to send the JSON as text too.
 */
const jsonResult = (value: Record<string, unknown>): CallToolResult => ({
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value,
});

/** Readable text for the model, with the same data as structured content. */
const textAndDataResult = (
    text: string,
    value: Record<string, unknown>,
): CallToolResult => ({
    content: [{ type: 'text', text }],
    structuredContent: value,
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

/** Parses an ISO 8601 date or date-time into epoch milliseconds. */
const parseInstant = (
    field: 'since' | 'until',
    value: string | undefined,
): Effect.Effect<number | undefined, ToolInputError> => {
    if (value === undefined) return Effect.succeed(undefined);
    // Without a zone, Date.parse reads date-times as local time. Workers run
    // in UTC; append Z so the meaning does not depend on that.
    const normalized = /^\d{4}-\d{2}-\d{2}T[^Zz+-]*$/u.test(value)
        ? `${value}Z`
        : value;
    const parsed = /^\d{4}-\d{2}-\d{2}/u.test(normalized)
        ? Date.parse(normalized)
        : Number.NaN;
    return Number.isFinite(parsed)
        ? Effect.succeed(parsed)
        : Effect.fail(
              new ToolInputError({
                  message: `Invalid ${field}. Use an ISO 8601 date or date-time, e.g. 2026-10-12 or 2026-10-12T08:00:00Z.`,
              }),
          );
};

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

const entryScope = (input: {
    readonly feedId?: number;
    readonly categoryId?: number;
}): Effect.Effect<ReaderEntryScope, ToolInputError> => {
    if (input.feedId !== undefined && input.categoryId !== undefined) {
        return Effect.fail(
            new ToolInputError({
                message: 'Pass feedId or categoryId, not both.',
            }),
        );
    }
    return Effect.succeed(
        input.feedId !== undefined
            ? { type: 'feed', id: input.feedId }
            : input.categoryId !== undefined
              ? { type: 'category', id: input.categoryId }
              : { type: 'all' },
    );
};

const dateRange = (input: {
    readonly since?: string;
    readonly until?: string;
}) =>
    Effect.gen(function* () {
        const from = yield* parseInstant('since', input.since);
        const to = yield* parseInstant('until', input.until);
        if (from !== undefined && to !== undefined && from >= to) {
            return yield* new ToolInputError({
                message: 'since must be earlier than until.',
            });
        }
        return {
            ...(from === undefined ? {} : { from }),
            ...(to === undefined ? {} : { to }),
        };
    });

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
                    return jsonResult({
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
                'Lists feed entries, newest first, with a short plain-text excerpt of each. Use get_entries or get_entry to read them.',
            inputSchema: ListEntriesInput,
            annotations: { readOnlyHint: true, openWorldHint: false },
        },
        (input) =>
            runTool(
                'list_entries',
                Effect.gen(function* () {
                    const scope = yield* entryScope(input);
                    const range = yield* dateRange(input);
                    const page = yield* reader.listEntries(userId, {
                        scope,
                        filter: input.filter ?? 'unread',
                        orderBy: input.orderBy ?? 'published_at',
                        cursor: yield* parseCursor(input.cursor),
                        pageSize: input.limit ?? DEFAULT_PAGE_SIZE,
                        range,
                    });
                    const excerptChars =
                        input.excerptChars ?? DEFAULT_EXCERPT_CHARS;
                    const excerpts =
                        excerptChars === 0
                            ? new Map<number, string>()
                            : yield* services
                                  .contentPrefixes(
                                      userId,
                                      page.entries.map((entry) => entry.id),
                                      // Markup usually outweighs text, so
                                      // read several times the excerpt.
                                      Math.min(
                                          16_384,
                                          excerptChars * 8 + 2_048,
                                      ),
                                  )
                                  .pipe(
                                      Effect.flatMap((prefixes) =>
                                          buildExcerpts(prefixes, excerptChars),
                                      ),
                                  );
                    return jsonResult({
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
                            ...(excerptChars === 0
                                ? {}
                                : { excerpt: excerpts.get(entry.id) ?? '' }),
                        })),
                    });
                }),
            ),
    );

    server.registerTool(
        'search_entries',
        {
            title: 'Search entries',
            description:
                'Finds entries by words in their title, author, or text, best matches first. Each result has a snippet with matched words in **bold**. New entries are searchable within a few minutes.',
            inputSchema: SearchEntriesInput,
            annotations: { readOnlyHint: true, openWorldHint: false },
        },
        (input) =>
            runTool(
                'search_entries',
                Effect.gen(function* () {
                    const match = yield* Effect.try({
                        try: () => toFtsQuery(input.query),
                        catch: (error) =>
                            new ToolInputError({
                                message:
                                    error instanceof SearchQueryError
                                        ? error.message
                                        : 'Invalid search query.',
                            }),
                    });
                    const limit = input.limit ?? 10;
                    const offset = input.offset ?? 0;
                    const page = yield* reader.searchEntries(userId, {
                        match,
                        scope: yield* entryScope(input),
                        filter: input.filter ?? 'all',
                        range: yield* dateRange(input),
                        limit,
                        offset,
                    });
                    return jsonResult({
                        results: page.results.map((entry) => ({
                            id: entry.id,
                            title: entry.title,
                            url: entry.url,
                            feedId: entry.feedId,
                            feed: entry.customFeedName ?? entry.feedName,
                            publishedAt: iso(entry.publishedAt),
                            read: entry.read,
                            starred: entry.starred,
                            snippet: entry.snippet,
                        })),
                        nextOffset: page.hasMore ? offset + limit : null,
                    });
                }),
            ),
    );

    server.registerTool(
        'get_entry',
        {
            title: 'Read entry',
            description:
                'Returns one entry with its content, up to maxChars. It does not mark the entry read.',
            inputSchema: GetEntryInput,
            annotations: {
                readOnlyHint: true,
                // fullContent fetches the article's web page.
                openWorldHint: true,
            },
        },
        (input) =>
            runTool(
                'get_entry',
                loadEntry(services, userId, input.entryId, {
                    format: input.format ?? 'text',
                    maxChars: input.maxChars ?? DEFAULT_ENTRY_CHARS,
                    fullContent: input.fullContent ?? false,
                }).pipe(
                    Effect.map((entry) =>
                        textAndDataResult(renderEntry(entry), { ...entry }),
                    ),
                ),
            ),
    );

    server.registerTool(
        'get_entries',
        {
            title: 'Read entries',
            description: `Returns up to ${MAX_BATCH_ENTRIES} entries with their content in one call, each cut to maxChars. Use it to read or summarize several articles. It does not mark them read.`,
            inputSchema: GetEntriesInput,
            annotations: { readOnlyHint: true, openWorldHint: true },
        },
        (input) =>
            runTool(
                'get_entries',
                Effect.gen(function* () {
                    const options = {
                        format: input.format ?? 'text',
                        maxChars: input.maxChars ?? DEFAULT_BATCH_ENTRY_CHARS,
                        fullContent: input.fullContent ?? false,
                    } as const;
                    const ids = [...new Set(input.entryIds)];
                    const loaded = yield* Effect.forEach(
                        ids,
                        (entryId) =>
                            loadEntry(services, userId, entryId, options).pipe(
                                Effect.map((entry) => ({ entryId, entry })),
                                Effect.catchTag('ReaderNotFound', () =>
                                    Effect.succeed({ entryId, entry: null }),
                                ),
                            ),
                        // Article fetches go to different websites; a few in
                        // parallel keep the call fast without a burst.
                        { concurrency: 4 },
                    );
                    const entries = loaded.flatMap(({ entry }) =>
                        entry === null ? [] : [entry],
                    );
                    const notFound = loaded.flatMap(({ entryId, entry }) =>
                        entry === null ? [entryId] : [],
                    );
                    const text = [
                        ...entries.map(renderEntry),
                        ...(notFound.length === 0
                            ? []
                            : [
                                  `Not found in this account: ${notFound.join(', ')}`,
                              ]),
                    ].join('\n\n======\n\n');
                    return textAndDataResult(text, { entries, notFound });
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
                    return jsonResult({ updated, notFound });
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
                            jsonResult({ feedId: result.feedId, read: true }),
                        ),
                    ),
            ),
    );

    server.registerTool(
        'feed_health',
        {
            title: 'Feed health',
            description:
                'Lists feeds that fail to refresh or are gone, with the last error and the last successful refresh.',
            inputSchema: FeedHealthInput,
            annotations: { readOnlyHint: true, openWorldHint: false },
        },
        (input) =>
            runTool(
                'feed_health',
                subscriptions.list(userId).pipe(
                    Effect.map(({ subscriptions: feeds }) => {
                        const described = feeds.map((feed) => ({
                            feedId: feed.feedId,
                            name: feed.customFeedName ?? feed.feedName,
                            category: feed.categoryName,
                            feedUrl: feed.feedUrl,
                            siteUrl: feed.siteUrl,
                            status: feed.isGone
                                ? 'gone'
                                : feed.consecutiveFailures > 0
                                  ? 'failing'
                                  : 'ok',
                            consecutiveFailures: feed.consecutiveFailures,
                            lastError:
                                feed.lastErrorMessage ?? feed.lastErrorClass,
                            lastAttemptAt: iso(feed.lastAttemptAt),
                            lastSuccessAt: iso(feed.lastSuccessfulRefreshAt),
                        }));
                        const problems = described.filter(
                            (feed) => feed.status !== 'ok',
                        );
                        return jsonResult({
                            totalFeeds: described.length,
                            failing: problems.filter(
                                (feed) => feed.status === 'failing',
                            ).length,
                            gone: problems.filter(
                                (feed) => feed.status === 'gone',
                            ).length,
                            feeds:
                                (input.onlyProblems ?? true)
                                    ? problems
                                    : described,
                        });
                    }),
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
                        return jsonResult({
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
                    return jsonResult({
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
                        jsonResult({
                            feedId: input.feedId,
                            unsubscribed: true,
                        }),
                    ),
                ),
            ),
    );

    return server;
};
