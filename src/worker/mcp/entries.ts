import type { ReaderEntryDetail } from '@shared/schemas/reader';
import { Effect } from 'effect';

import type {
    FullContentRateLimited,
    FullContentStorageError,
} from '../fullcontent/errors';
import type { FullContentService } from '../fullcontent/service';
import type { ReaderService } from '../reader/service';
import { htmlToText, truncateText } from './content';

/*
 * Loads one entry for MCP and renders it for a language model: metadata, the
 * article body as plain text or HTML, an optional full-article fetch, and a
 * size limit so one long article cannot fill the client's context.
 */

export type EntryFormat = 'text' | 'html';

export interface EntryContentServices {
    readonly reader: ReaderService;
    /** Null when full-article fetching is not configured. */
    readonly fullContent: FullContentService | null;
    readonly limitFullContent: (
        userId: number,
    ) => Effect.Effect<void, FullContentRateLimited | FullContentStorageError>;
}

export interface EntryContentOptions {
    readonly format: EntryFormat;
    readonly maxChars: number;
    readonly fullContent: boolean;
}

/** The entry as returned in `structuredContent`. */
export interface RenderedEntry {
    readonly id: number;
    readonly title: string;
    readonly url: string | null;
    readonly author: string | null;
    readonly feedId: number;
    readonly feed: string;
    readonly publishedAt: string;
    readonly read: boolean;
    readonly starred: boolean;
    readonly archived: boolean;
    /** `article` when the body came from the fetched web page. */
    readonly contentSource: 'feed' | 'article';
    /** Why the full article was not used, when it was requested. */
    readonly fullContentError: string | null;
    readonly truncated: boolean;
    readonly content: string;
}

const fullContentErrors: Readonly<Record<string, string>> = {
    FullContentDisabled: 'full article fetching is turned off',
    FullContentRateLimited: 'too many article fetches; try again in a minute',
    FullContentSourceMissing: 'the entry has no article URL',
    FullContentExtractError: 'no article text was found on the page',
    FullContentTooLarge: 'the article is too large',
    FullContentUnavailable: 'the website did not respond correctly',
    FullContentFetchError: 'the website could not be fetched',
};

const errorTag = (error: unknown): string =>
    typeof error === 'object' && error !== null
        ? String(Reflect.get(error, '_tag') ?? 'Unknown')
        : 'Unknown';

/**
 * Returns the fetched article HTML, or the reason it is unavailable. Fetching
 * failures never fail the tool: the feed's own content is still useful.
 */
const fetchArticleHtml = (
    services: EntryContentServices,
    userId: number,
    entryId: number,
): Effect.Effect<
    { readonly html: string } | { readonly error: string },
    never
> => {
    const fullContent = services.fullContent;
    if (fullContent === null) {
        return Effect.succeed({ error: fullContentErrors.FullContentDisabled });
    }
    return services.limitFullContent(userId).pipe(
        Effect.flatMap(() => fullContent.fetchContent(userId, entryId)),
        Effect.map((response) =>
            response.fullContent === null
                ? { error: fullContentErrors.FullContentExtractError }
                : { html: response.fullContent.html },
        ),
        Effect.catch((error: unknown) =>
            Effect.succeed({
                error:
                    fullContentErrors[errorTag(error)] ??
                    'the article could not be fetched',
            }),
        ),
    );
};

const iso = (timestamp: number): string => new Date(timestamp).toISOString();

export const loadEntry = (
    services: EntryContentServices,
    userId: number,
    entryId: number,
    options: EntryContentOptions,
) =>
    Effect.gen(function* () {
        const entry: ReaderEntryDetail = yield* services.reader.findEntry(
            userId,
            entryId,
        );
        let html = entry.contentHtml ?? '';
        let contentSource: RenderedEntry['contentSource'] = 'feed';
        let fullContentError: string | null = null;
        if (options.fullContent) {
            const article = yield* fetchArticleHtml(services, userId, entryId);
            if ('html' in article) {
                html = article.html;
                contentSource = 'article';
            } else {
                fullContentError = article.error;
            }
        }
        const body =
            options.format === 'html'
                ? html
                : yield* Effect.promise(() => htmlToText(html));
        const { text, truncated } = truncateText(body, options.maxChars);
        return {
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
            contentSource,
            fullContentError,
            truncated,
            content: text,
        } satisfies RenderedEntry;
    });

/** Renders an entry as Markdown-style text for the tool's text content. */
export const renderEntry = (entry: RenderedEntry): string => {
    const status = [
        entry.read ? 'read' : 'unread',
        ...(entry.starred ? ['starred'] : []),
        ...(entry.archived ? ['archived'] : []),
    ].join(', ');
    const notes = [
        ...(entry.contentSource === 'article'
            ? ['Content: full article fetched from the website.']
            : []),
        ...(entry.fullContentError === null
            ? []
            : [`Content: feed content only; ${entry.fullContentError}.`]),
        ...(entry.truncated
            ? [
                  'Content was truncated. Call get_entry with a larger maxChars to read more.',
              ]
            : []),
    ];
    return [
        `# ${entry.title || '(untitled)'}`,
        '',
        `Entry ID: ${entry.id}`,
        `Feed: ${entry.feed} (feed ID ${entry.feedId})`,
        ...(entry.author === null ? [] : [`Author: ${entry.author}`]),
        `Published: ${entry.publishedAt}`,
        ...(entry.url === null ? [] : [`URL: ${entry.url}`]),
        `Status: ${status}`,
        ...notes,
        '',
        '---',
        '',
        entry.content.length > 0
            ? entry.content
            : '(This entry has no stored content. Open the URL, or call get_entry with fullContent: true.)',
    ].join('\n');
};

/**
 * Builds plain-text excerpts from HTML prefixes. A prefix may cut a tag in
 * half; HTMLRewriter treats the rest as text, which the truncation drops.
 */
export const buildExcerpts = (
    prefixes: ReadonlyMap<number, string>,
    maxChars: number,
): Effect.Effect<ReadonlyMap<number, string>> =>
    Effect.forEach(
        [...prefixes],
        ([entryId, html]) =>
            Effect.promise(() => htmlToText(html)).pipe(
                Effect.map(
                    (text) =>
                        [entryId, truncateText(text, maxChars).text] as const,
                ),
            ),
        { concurrency: 8 },
    ).pipe(Effect.map((pairs) => new Map(pairs)));
