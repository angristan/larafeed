import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import {
    type CallToolResult,
    McpServer,
    requireScopes,
} from '@modelcontextprotocol/server';
import type { ReaderEntry } from '@shared/schemas/reader';
import { ReaderFilter, ReaderOrder } from '@shared/schemas/reader';
import { Cause, Effect, Exit, Schema } from 'effect';
import {
    SHOW_ENTRIES_TOOL,
    type ShowEntriesData,
    VIEW_URI,
} from '../../mcp-app/contract';
import { safeErrorClass, spanNames, traceAsync } from '../observability';
import type { ReaderEntryScope } from '../reader/repository';
import type { ReaderService } from '../reader/service';
import { SearchQueryError, toFtsQuery } from '../search/query';
import type {
    SubscriptionRateLimited,
    SubscriptionStorageError,
} from '../subscriptions/errors';
import type { SubscriptionService } from '../subscriptions/service';
import { registerEntriesView, toShowEntry } from './app';
import {
    buildExcerpts,
    type EntryContentServices,
    loadEntry,
    renderEntry,
} from './entries';
import { entryLine, lines, shortDate } from './format';
import { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from './oauth';
import { toolInput } from './schema';

export interface McpToolServices extends EntryContentServices {
    /** Larafeed's public origin, for absolute favicon URLs in the app. */
    readonly publicOrigin: string;
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

// Sent once per session. Tool descriptions carry the details.
const INSTRUCTIONS = `Larafeed is the user's feed reader. Entry lists read "id · date (UTC) · feed · title [flags]", with an excerpt or snippet below.
Browse with list_entries, find with search_entries, read with get_entries (fullContent: true fetches the web page when a feed only has a teaser). Reading does not mark entries read; update_entries does.
show_entries displays entries as an interactive card, only when the user wants to see or browse them.
Confirm with the user before unsubscribe.`;

// Updating one entry's read, starred, and archived state can take 12 D1
// statements. 50 entries stay under D1's 1,000 queries per invocation, with
// room for the token and connection checks.
const MAX_UPDATE_IDS = 50;
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_EXCERPT_CHARS = 200;
const MAX_READ_IDS = 20;
const SINGLE_ENTRY_CHARS = 20_000;
const BATCH_ENTRY_CHARS = 4_000;
// Caps one get_entries result at about 200,000 characters of bodies.
const MAX_TOTAL_CHARS = 200_000;
const CURSOR_PATTERN = /^(\d{1,15}):(\d{1,15})$/u;

// Every write tool needs both scopes: the client steps up to `mcp:write` when
// the user granted read access only.
const writeScopes = requireScopes(MCP_READ_SCOPE, MCP_WRITE_SCOPE);

const SafeId = Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);
const intBetween = (minimum: number, maximum: number) =>
    Schema.Int.check(Schema.isBetween({ minimum, maximum }));
const described = <S extends Schema.Top>(schema: S, description: string) =>
    Schema.optionalKey(schema.annotate({ description }));

// Descriptions state only what the schema cannot: meaning and defaults.
const scopeFields = {
    feedId: Schema.optionalKey(SafeId),
    categoryId: described(SafeId, 'Not with feedId.'),
};
const rangeFields = {
    since: described(
        Schema.String,
        'ISO 8601 date or time, inclusive. UTC without a zone.',
    ),
    until: described(Schema.String, 'ISO 8601, exclusive.'),
};

const ListEntriesInput = toolInput(
    Schema.Struct({
        filter: described(ReaderFilter, 'Default unread. favorites = starred.'),
        ...scopeFields,
        orderBy: described(
            ReaderOrder,
            'Default published_at; created_at is fetch time. since/until use it too.',
        ),
        ...rangeFields,
        cursor: described(Schema.String, 'nextCursor of the previous page.'),
        limit: described(intBetween(1, 100), 'Default 20.'),
        excerptChars: described(intBetween(0, 1_000), 'Default 200; 0 omits.'),
    }),
);

const SearchEntriesInput = toolInput(
    Schema.Struct({
        query: Schema.String.check(Schema.isLengthBetween(1, 500)).annotate({
            description:
                'All words must match. Also "phrase", prefix*, a OR b, -excluded.',
        }),
        filter: described(ReaderFilter, 'Default all.'),
        ...scopeFields,
        ...rangeFields,
        limit: described(intBetween(1, 50), 'Default 10.'),
        offset: described(
            intBetween(0, 500),
            'nextOffset of the previous page.',
        ),
    }),
);

const GetEntriesInput = toolInput(
    Schema.Struct({
        entryIds: Schema.Array(SafeId).check(
            Schema.isMinLength(1),
            Schema.isMaxLength(MAX_READ_IDS),
        ),
        format: described(Schema.Literals(['text', 'html']), 'Default text.'),
        fullContent: described(
            Schema.Boolean,
            'Fetch the article from its website, for feeds with only a teaser.',
        ),
        maxChars: described(
            intBetween(500, 100_000),
            'Per entry. Default 20000 for one entry, 4000 for several.',
        ),
    }),
);

const UpdateEntriesInput = toolInput(
    Schema.Struct({
        entryIds: Schema.optionalKey(
            Schema.Array(SafeId).check(
                Schema.isMinLength(1),
                Schema.isMaxLength(MAX_UPDATE_IDS),
            ),
        ),
        feedId: described(
            SafeId,
            'Instead of entryIds: every entry in the feed. Only with read: true.',
        ),
        read: Schema.optionalKey(Schema.Boolean),
        starred: Schema.optionalKey(Schema.Boolean),
        archived: Schema.optionalKey(Schema.Boolean),
    }),
);

const ShowEntriesInput = toolInput(
    Schema.Struct({
        filter: described(ReaderFilter, 'Default unread.'),
        ...scopeFields,
        ...rangeFields,
        entryIds: described(
            Schema.Array(SafeId).check(
                Schema.isMinLength(1),
                Schema.isMaxLength(MAX_UPDATE_IDS),
            ),
            'Show these entries instead, e.g. search results.',
        ),
        limit: described(intBetween(1, 50), 'Default 20.'),
        cursor: Schema.optionalKey(Schema.String),
    }),
);

const FeedHealthInput = toolInput(
    Schema.Struct({
        all: described(Schema.Boolean, 'Include healthy feeds.'),
    }),
);

const SubscribeInput = toolInput(
    Schema.Struct({
        url: Schema.String.check(
            Schema.isTrimmed(),
            Schema.isLengthBetween(1, 2_048),
        ).annotate({ description: 'Feed or website URL.' }),
        categoryId: Schema.optionalKey(SafeId),
        categoryName: described(
            Schema.String.check(
                Schema.isTrimmed(),
                Schema.isLengthBetween(1, 255),
            ),
            'New category. Pass exactly one of categoryId or categoryName.',
        ),
    }),
);

const FeedInput = toolInput(Schema.Struct({ feedId: SafeId }));

const iso = (timestamp: number | null): string | null =>
    timestamp === null ? null : new Date(timestamp).toISOString();

/** Small results: the JSON is already compact. */
const jsonResult = (value: Record<string, unknown>): CallToolResult => ({
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value,
});

/** Compact text for the model; the full JSON for clients that read it. */
const textResult = (
    text: string,
    value: Record<string, unknown>,
): CallToolResult => ({
    content: [{ type: 'text', text }],
    structuredContent: value,
});

const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
const writes = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
} as const;

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

    const excerptsFor = (entryIds: readonly number[], chars: number) =>
        chars === 0 || entryIds.length === 0
            ? Effect.succeed(new Map<number, string>())
            : services
                  .contentPrefixes(
                      userId,
                      entryIds,
                      // Markup usually outweighs text, so read several
                      // times the excerpt length.
                      Math.min(16_384, chars * 8 + 2_048),
                  )
                  .pipe(
                      Effect.flatMap((prefixes) =>
                          buildExcerpts(prefixes, chars),
                      ),
                  );

    server.registerTool(
        'list_subscriptions',
        {
            description: 'Categories, feeds, and unread counts.',
            annotations: readOnly,
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
                    const grouped = categories.categories.map((category) => ({
                        id: category.id,
                        name: category.name,
                        feeds: feeds.subscriptions
                            .filter((feed) => feed.categoryId === category.id)
                            .map((feed) => ({
                                feedId: feed.feedId,
                                name: feed.customFeedName ?? feed.feedName,
                                unread: feed.unreadCount,
                                total: feed.totalCount,
                            })),
                    }));
                    return textResult(
                        lines(
                            `unread ${counts.unread} · starred ${counts.starred} · total ${counts.total}`,
                            ...grouped.flatMap((category) => [
                                `## ${category.name} (category ${category.id})`,
                                ...category.feeds.map(
                                    (feed) =>
                                        `${feed.feedId} · ${feed.name} · ${feed.unread}/${feed.total} unread`,
                                ),
                            ]),
                        ),
                        {
                            counts: {
                                unread: counts.unread,
                                starred: counts.starred,
                                total: counts.total,
                            },
                            categories: grouped,
                        },
                    );
                }),
            ),
    );

    server.registerTool(
        'list_entries',
        {
            description: 'Entries, newest first, with excerpts.',
            inputSchema: ListEntriesInput,
            annotations: readOnly,
        },
        (input) =>
            runTool(
                'list_entries',
                Effect.gen(function* () {
                    const page = yield* reader.listEntries(userId, {
                        scope: yield* entryScope(input),
                        filter: input.filter ?? 'unread',
                        orderBy: input.orderBy ?? 'published_at',
                        cursor: yield* parseCursor(input.cursor),
                        pageSize: input.limit ?? DEFAULT_PAGE_SIZE,
                        range: yield* dateRange(input),
                    });
                    const excerptChars =
                        input.excerptChars ?? DEFAULT_EXCERPT_CHARS;
                    const excerpts = yield* excerptsFor(
                        page.entries.map((entry) => entry.id),
                        excerptChars,
                    );
                    const entries = page.entries.map((entry) => ({
                        ...entry,
                        feed: entry.customFeedName ?? entry.feedName,
                        excerpt: excerpts.get(entry.id),
                    }));
                    return textResult(
                        lines(
                            `${page.total} entries${page.nextCursor === null ? '' : ` · next cursor ${page.nextCursor}`}`,
                            ...entries.map((entry) =>
                                entryLine(entry, entry.excerpt),
                            ),
                        ),
                        {
                            total: page.total,
                            nextCursor: page.nextCursor,
                            entries: entries.map((entry) => ({
                                id: entry.id,
                                title: entry.title,
                                url: entry.url,
                                author: entry.author,
                                feedId: entry.feedId,
                                feed: entry.feed,
                                publishedAt: iso(entry.publishedAt),
                                read: entry.read,
                                starred: entry.starred,
                                archived: entry.archived,
                                ...(excerptChars === 0
                                    ? {}
                                    : { excerpt: entry.excerpt ?? '' }),
                            })),
                        },
                    );
                }),
            ),
    );

    registerEntriesView(server, services.publicOrigin);
    registerAppTool(
        server,
        SHOW_ENTRIES_TOOL,
        {
            description:
                'Shows entries to the user as an interactive card to browse, star, and mark read. Use only when the user wants to see entries; use list_entries to read them yourself.',
            inputSchema: ShowEntriesInput,
            annotations: readOnly,
            _meta: { ui: { resourceUri: VIEW_URI } },
        },
        (input) =>
            runTool(
                SHOW_ENTRIES_TOOL,
                Effect.gen(function* () {
                    let total: number;
                    let nextCursor: string | null = null;
                    let found: readonly ReaderEntry[];
                    if (input.entryIds !== undefined) {
                        const loaded = yield* Effect.forEach(
                            [...new Set(input.entryIds)],
                            (entryId) =>
                                reader.findEntry(userId, entryId).pipe(
                                    Effect.map(
                                        (entry): ReaderEntry | null => entry,
                                    ),
                                    Effect.catchTag('ReaderNotFound', () =>
                                        Effect.succeed(null),
                                    ),
                                ),
                            { concurrency: 4 },
                        );
                        found = loaded.filter(
                            (entry): entry is ReaderEntry => entry !== null,
                        );
                        total = found.length;
                    } else {
                        const page = yield* reader.listEntries(userId, {
                            scope: yield* entryScope(input),
                            filter: input.filter ?? 'unread',
                            orderBy: 'published_at',
                            cursor: yield* parseCursor(input.cursor),
                            pageSize: input.limit ?? DEFAULT_PAGE_SIZE,
                            range: yield* dateRange(input),
                        });
                        found = page.entries;
                        total = page.total;
                        nextCursor = page.nextCursor;
                    }
                    const excerpts = yield* excerptsFor(
                        found.map((entry) => entry.id),
                        DEFAULT_EXCERPT_CHARS,
                    );
                    const { cursor: _cursor, ...request } = input;
                    const data: ShowEntriesData = {
                        total,
                        nextCursor,
                        request,
                        entries: found.map((entry) =>
                            toShowEntry(
                                entry,
                                excerpts.get(entry.id) ?? '',
                                services.publicOrigin,
                            ),
                        ),
                    };
                    return textResult(
                        lines(
                            `Shown to the user as an interactive card. ${total} entries${nextCursor === null ? '' : ` · next cursor ${nextCursor}`}`,
                            ...data.entries.map((entry) =>
                                entryLine(entry, entry.excerpt),
                            ),
                        ),
                        { ...data },
                    );
                }),
            ),
    );

    server.registerTool(
        'search_entries',
        {
            description:
                'Full-text search of titles, authors, and article text; best matches first, snippets with **matches**. New entries appear within minutes.',
            inputSchema: SearchEntriesInput,
            annotations: readOnly,
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
                    const nextOffset = page.hasMore ? offset + limit : null;
                    const results = page.results.map((entry) => ({
                        ...entry,
                        feed: entry.customFeedName ?? entry.feedName,
                    }));
                    return textResult(
                        lines(
                            `${results.length} results${nextOffset === null ? '' : ` · next offset ${nextOffset}`}`,
                            ...results.map((entry) =>
                                entryLine(entry, entry.snippet),
                            ),
                        ),
                        {
                            results: results.map((entry) => ({
                                id: entry.id,
                                title: entry.title,
                                url: entry.url,
                                feedId: entry.feedId,
                                feed: entry.feed,
                                publishedAt: iso(entry.publishedAt),
                                read: entry.read,
                                starred: entry.starred,
                                snippet: entry.snippet,
                            })),
                            nextOffset,
                        },
                    );
                }),
            ),
    );

    server.registerTool(
        'get_entries',
        {
            description:
                'Reads entries with their content. Does not mark them read.',
            inputSchema: GetEntriesInput,
            // fullContent fetches the article's web page.
            annotations: { readOnlyHint: true, openWorldHint: true },
        },
        (input) =>
            runTool(
                'get_entries',
                Effect.gen(function* () {
                    const ids = [...new Set(input.entryIds)];
                    const requested =
                        input.maxChars ??
                        (ids.length === 1
                            ? SINGLE_ENTRY_CHARS
                            : BATCH_ENTRY_CHARS);
                    const options = {
                        format: input.format ?? 'text',
                        maxChars: Math.min(
                            requested,
                            Math.floor(MAX_TOTAL_CHARS / ids.length),
                        ),
                        fullContent: input.fullContent ?? false,
                    } as const;
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
                    return textResult(
                        [
                            ...entries.map(renderEntry),
                            ...(notFound.length === 0
                                ? []
                                : [`Not found: ${notFound.join(', ')}`]),
                        ].join('\n\n---\n\n'),
                        { entries, notFound },
                    );
                }),
            ),
    );

    server.registerTool(
        'update_entries',
        {
            description:
                'Sets read, starred, or archived on entries, or marks a whole feed read.',
            inputSchema: UpdateEntriesInput,
            annotations: writes,
            scopeChallenge: writeScopes,
        },
        (input) =>
            runTool(
                'update_entries',
                Effect.gen(function* () {
                    if (input.feedId !== undefined) {
                        if (
                            input.entryIds !== undefined ||
                            input.read !== true ||
                            input.starred !== undefined ||
                            input.archived !== undefined
                        ) {
                            return yield* new ToolInputError({
                                message:
                                    'With feedId, pass only read: true (no entryIds, starred, or archived).',
                            });
                        }
                        const result = yield* reader.advanceReadThrough(
                            userId,
                            input.feedId,
                        );
                        return jsonResult({
                            feedId: result.feedId,
                            read: true,
                        });
                    }
                    if (input.entryIds === undefined) {
                        return yield* new ToolInputError({
                            message: 'Pass entryIds or feedId.',
                        });
                    }
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
        'feed_health',
        {
            description:
                'Feeds that fail to refresh or are gone, with the last error and last success.',
            inputSchema: FeedHealthInput,
            annotations: readOnly,
        },
        (input) =>
            runTool(
                'feed_health',
                subscriptions.list(userId).pipe(
                    Effect.map(({ subscriptions: all }) => {
                        const feeds = all.map((feed) => ({
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
                            lastAttemptAt: feed.lastAttemptAt,
                            lastSuccessAt: feed.lastSuccessfulRefreshAt,
                        }));
                        const shown =
                            input.all === true
                                ? feeds
                                : feeds.filter((feed) => feed.status !== 'ok');
                        const failing = feeds.filter(
                            (feed) => feed.status === 'failing',
                        ).length;
                        const gone = feeds.filter(
                            (feed) => feed.status === 'gone',
                        ).length;
                        return textResult(
                            lines(
                                `${feeds.length} feeds · ${failing} failing · ${gone} gone`,
                                ...shown.map(
                                    (feed) =>
                                        `${feed.feedId} · ${feed.name} · ${feed.status}${feed.consecutiveFailures > 0 ? ` (${feed.consecutiveFailures} failures)` : ''} · last success ${shortDate(feed.lastSuccessAt)}${feed.lastError === null ? '' : ` · ${feed.lastError}`}`,
                                ),
                            ),
                            {
                                totalFeeds: feeds.length,
                                failing,
                                gone,
                                feeds: shown.map((feed) => ({
                                    ...feed,
                                    lastAttemptAt: iso(feed.lastAttemptAt),
                                    lastSuccessAt: iso(feed.lastSuccessAt),
                                })),
                            },
                        );
                    }),
                ),
            ),
    );

    server.registerTool(
        'subscribe',
        {
            description:
                'Subscribes to a feed or website URL. If a site has several feeds, returns them; call again with one.',
            inputSchema: SubscribeInput,
            annotations: {
                ...writes,
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
            description:
                'Removes a subscription and its read and starred state.',
            inputSchema: FeedInput,
            annotations: { ...writes, destructiveHint: true },
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
