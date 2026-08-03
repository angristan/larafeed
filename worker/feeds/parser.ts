import { ALL_ENTITIES, COMMON_HTML } from '@nodable/entities';
import { XMLParser } from 'fast-xml-parser';

import { FeedParseError } from './errors';
import { MAX_CONTENT_BYTES, sanitizeArticleHtml } from './sanitize';

// Refresh persistence uses at most two D1 statements per entry plus fixed
// bookkeeping statements. This leaves headroom below the paid Workers limit of
// 1,000 D1 queries per invocation while allowing complete normal feed refreshes.
export const MAX_FEED_ENTRIES = 400;
export const MAX_FEED_ITEMS_TO_PARSE = 1_000;

export type ContentStatus = 'stored' | 'empty' | 'oversized';

export interface EntryUpdateMask {
    readonly title: boolean;
    readonly url: boolean;
    readonly author: boolean;
    readonly publishedAt: boolean;
    readonly sourceUpdatedAt: boolean;
    readonly content: boolean;
}

export interface NormalizedFeedMetadata {
    readonly title: string;
    readonly siteUrl: string | null;
    readonly faviconUrl: string | null;
    readonly description: string | null;
    readonly sourceUpdatedAt: number | null;
}

export interface NormalizedFeedEntry {
    /** Canonical parser identity. Priority: source ID, resolved link, fallback. */
    readonly sourceIdentity: string;
    readonly deduplicationKey: Uint8Array;
    readonly sourceId: string | null;
    readonly title: string;
    readonly url: string | null;
    readonly author: string | null;
    readonly publishedAt: number;
    readonly sourceUpdatedAt: number | null;
    readonly contentHtml: string | null;
    readonly contentEncodedSize: number;
    readonly contentStatus: ContentStatus;
    readonly updateMask: EntryUpdateMask;
}

export interface ParsedFeed {
    readonly metadata: NormalizedFeedMetadata;
    readonly entries: readonly NormalizedFeedEntry[];
}

interface ParseFeedOptions {
    readonly finalUrl: URL;
    readonly fetchedAt: number;
    readonly contentType?: string | null;
    readonly webCrypto?: Crypto;
}

type XmlRecord = Record<string, unknown>;

type FeedKind = 'rss' | 'atom' | 'rdf';

interface FeedShape {
    readonly kind: FeedKind;
    readonly metadata: XmlRecord;
    readonly items: readonly unknown[];
}

type ParsedSourceDate =
    | { readonly kind: 'missing' | 'invalid' | 'future' }
    | { readonly kind: 'valid'; readonly timestamp: number };

interface EntryCandidate {
    readonly sourceIdentity: string;
    readonly sourceId: string | null;
    readonly title: string;
    readonly url: string | null;
    readonly author: string | null;
    readonly publishedAt: number;
    readonly sourceUpdatedAt: number | null;
    readonly sortTimestamp: number | null;
    readonly contentHtml: string | null;
    readonly contentEncodedSize: number;
    readonly contentStatus: ContentStatus;
    readonly updateMask: EntryUpdateMask;
    readonly sourceIndex: number;
}

const parser = new XMLParser({
    allowBooleanAttributes: false,
    ignoreAttributes: false,
    ignoreDeclaration: true,
    ignorePiTags: true,
    maxNestedTags: 100,
    parseAttributeValue: false,
    parseTagValue: false,
    processEntities: {
        enabled: true,
        maxEntityCount: 0,
        maxEntitySize: 0,
        maxExpandedLength: 100_000,
        maxTotalExpansions: 1_000,
    },
    removeNSPrefix: true,
    transformAttributeName: (name) =>
        name.split(':').at(-1)?.toLowerCase() ?? name,
    transformTagName: (name) => name.split(':').at(-1)?.toLowerCase() ?? name,
    trimValues: true,
});

const record = (value: unknown): XmlRecord | undefined =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as XmlRecord)
        : undefined;

const firstRecord = (value: unknown): XmlRecord | undefined => {
    if (Array.isArray(value)) {
        return record(value[0]);
    }
    return record(value);
};

const array = (value: unknown): readonly unknown[] =>
    value === undefined ? [] : Array.isArray(value) ? value : [value];

const scalarText = (value: unknown): string | undefined => {
    if (typeof value === 'string' || typeof value === 'number') {
        const text = String(value).trim();
        return text === '' ? undefined : text;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            const text = scalarText(item);
            if (text !== undefined) {
                return text;
            }
        }
        return undefined;
    }
    const object = record(value);
    if (object === undefined) {
        return undefined;
    }
    return scalarText(object['#text']) ?? scalarText(object.name);
};

const firstText = (
    object: XmlRecord,
    ...keys: readonly string[]
): string | undefined => {
    for (const key of keys) {
        const text = scalarText(object[key]);
        if (text !== undefined) {
            return text;
        }
    }
    return undefined;
};

const boundedText = (
    value: string | undefined,
    maximum: number,
): string | undefined => value?.slice(0, maximum);

const titleEntities: Readonly<Record<string, string>> = {
    ...ALL_ENTITIES,
    ...COMMON_HTML,
};

const decodedCodePoint = (value: string, radix: 10 | 16): string => {
    const codePoint = Number.parseInt(value, radix);
    return codePoint === 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? '\ufffd'
        : String.fromCodePoint(codePoint);
};

/** Decode one bounded entity layer. Markup is returned as literal text only. */
const plainTextTitle = (
    value: string | undefined,
    maximum: number,
): string | undefined =>
    boundedText(value, maximum)?.replace(
        /&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/gu,
        (
            match,
            decimal: string | undefined,
            hexadecimal: string | undefined,
            named: string | undefined,
        ) => {
            if (decimal !== undefined) {
                return decodedCodePoint(decimal, 10);
            }
            if (hexadecimal !== undefined) {
                return decodedCodePoint(hexadecimal, 16);
            }
            return named === undefined
                ? match
                : (titleEntities[named] ?? match);
        },
    );

const escaped = (value: string): string =>
    value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');

const htmlFromValue = (value: unknown): string | undefined => {
    if (typeof value === 'string' || typeof value === 'number') {
        return String(value);
    }
    if (Array.isArray(value)) {
        const html = value.map(htmlFromValue).filter(Boolean).join('');
        return html === '' ? undefined : html;
    }
    const object = record(value);
    if (object === undefined) {
        return undefined;
    }

    const output: string[] = [];
    if (object['#text'] !== undefined) {
        output.push(String(object['#text']));
    }
    for (const [name, child] of Object.entries(object)) {
        if (name === '#text' || name.startsWith('@_')) {
            continue;
        }
        for (const item of array(child)) {
            const inner = htmlFromValue(item) ?? '';
            const attributes = record(item);
            const serializedAttributes =
                attributes === undefined
                    ? ''
                    : Object.entries(attributes)
                          .filter(([attribute]) => attribute.startsWith('@_'))
                          .map(
                              ([attribute, attributeValue]) =>
                                  ` ${attribute.slice(2)}="${escaped(String(attributeValue))}"`,
                          )
                          .join('');
            output.push(`<${name}${serializedAttributes}>${inner}</${name}>`);
        }
    }
    return output.length === 0 ? undefined : output.join('');
};

const parseSourceDate = (
    value: string | undefined,
    now: number,
): ParsedSourceDate => {
    if (value === undefined) {
        return { kind: 'missing' };
    }
    if (value.length > 256) {
        return { kind: 'invalid' };
    }

    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp) || timestamp < 0) {
        return { kind: 'invalid' };
    }
    return timestamp > now ? { kind: 'future' } : { kind: 'valid', timestamp };
};

const validTimestamp = (date: ParsedSourceDate): number | null =>
    date.kind === 'valid' ? date.timestamp : null;

const entryDateSelection = (
    rawPublished: string | undefined,
    rawUpdated: string | undefined,
    fetchedAt: number,
):
    | {
          readonly published: number | null;
          readonly sourceUpdatedAt: number | null;
      }
    | undefined => {
    const publishedDate = parseSourceDate(rawPublished, fetchedAt);
    const updatedDate = parseSourceDate(rawUpdated, fetchedAt);

    // Legacy ingestion selects published, then updated, then fetch time. A
    // selected explicit future date drops the entry instead of using fetch time.
    if (
        publishedDate.kind === 'future' ||
        (publishedDate.kind !== 'valid' && updatedDate.kind === 'future')
    ) {
        return undefined;
    }

    return {
        published: validTimestamp(publishedDate),
        sourceUpdatedAt: validTimestamp(updatedDate),
    };
};

const resolveHttpUrl = (
    value: string | undefined,
    baseUrl: URL,
): string | null => {
    if (value === undefined || value.length > 8_192) {
        return null;
    }
    try {
        const url = new URL(value, baseUrl);
        return (url.protocol === 'http:' || url.protocol === 'https:') &&
            url.username === '' &&
            url.password === ''
            ? url.href
            : null;
    } catch {
        return null;
    }
};

const atomLink = (
    value: unknown,
    baseUrl: URL,
    preferredRel: string,
): string | null => {
    const links = array(value);
    const preferred = links.find((link) => {
        const object = record(link);
        return (scalarText(object?.['@_rel']) ?? 'alternate') === preferredRel;
    });
    const selected = preferred ?? links[0];
    const object = record(selected);
    return resolveHttpUrl(
        scalarText(object?.['@_href']) ?? scalarText(selected),
        baseUrl,
    );
};

const feedShape = (document: unknown): FeedShape => {
    const root = record(document);
    const rss = firstRecord(root?.rss);
    const rssChannel = firstRecord(rss?.channel);
    if (rssChannel !== undefined) {
        return {
            kind: 'rss',
            metadata: rssChannel,
            items: array(rssChannel.item),
        };
    }

    const atom = firstRecord(root?.feed);
    if (atom !== undefined) {
        return {
            kind: 'atom',
            metadata: atom,
            items: array(atom.entry),
        };
    }

    const rdf = firstRecord(root?.rdf);
    const rdfChannel = firstRecord(rdf?.channel);
    if (rdf !== undefined && rdfChannel !== undefined) {
        return {
            kind: 'rdf',
            metadata: rdfChannel,
            items: array(rdf.item),
        };
    }

    throw new FeedParseError({ reason: 'unsupported_feed' });
};

const feedIconUrl = (shape: FeedShape, finalUrl: URL): string | null => {
    if (shape.kind === 'atom') {
        return resolveHttpUrl(
            firstText(shape.metadata, 'icon', 'logo'),
            finalUrl,
        );
    }

    const image = firstRecord(shape.metadata.image);
    return resolveHttpUrl(
        firstText(image ?? {}, 'url') ?? scalarText(image?.['@_href']),
        finalUrl,
    );
};

const metadataFromShape = (
    shape: FeedShape,
    finalUrl: URL,
    fetchedAt: number,
): NormalizedFeedMetadata => {
    const title =
        plainTextTitle(firstText(shape.metadata, 'title'), 500) ??
        finalUrl.hostname;
    const siteUrl =
        shape.kind === 'atom'
            ? atomLink(shape.metadata.link, finalUrl, 'alternate')
            : resolveHttpUrl(firstText(shape.metadata, 'link'), finalUrl);
    const sourceUpdatedAt = validTimestamp(
        parseSourceDate(
            firstText(shape.metadata, 'updated', 'lastbuilddate', 'date'),
            fetchedAt,
        ),
    );

    return {
        title,
        siteUrl,
        faviconUrl: feedIconUrl(shape, finalUrl),
        description:
            boundedText(
                firstText(shape.metadata, 'subtitle', 'description'),
                4_000,
            ) ?? null,
        sourceUpdatedAt,
    };
};

const itemLink = (
    kind: FeedKind,
    item: XmlRecord,
    finalUrl: URL,
): string | null =>
    kind === 'atom'
        ? atomLink(item.link, finalUrl, 'alternate')
        : resolveHttpUrl(firstText(item, 'link'), finalUrl);

const contentForItem = (item: XmlRecord): string | undefined => {
    for (const key of ['encoded', 'content', 'description', 'summary']) {
        const content = htmlFromValue(item[key]);
        if (content !== undefined && content.trim() !== '') {
            return content;
        }
    }
    return undefined;
};

const normalizedContent = (
    source: string | undefined,
    finalUrl: URL,
): Pick<
    EntryCandidate,
    'contentHtml' | 'contentEncodedSize' | 'contentStatus'
> => {
    if (source === undefined) {
        return {
            contentHtml: null,
            contentEncodedSize: 0,
            contentStatus: 'empty',
        };
    }

    const html = sanitizeArticleHtml(source, finalUrl);
    if (html === '') {
        return {
            contentHtml: null,
            contentEncodedSize: 0,
            contentStatus: 'empty',
        };
    }

    const encodedSize = new TextEncoder().encode(html).byteLength;
    return encodedSize > MAX_CONTENT_BYTES
        ? {
              contentHtml: null,
              contentEncodedSize: encodedSize,
              contentStatus: 'oversized',
          }
        : {
              contentHtml: html,
              contentEncodedSize: encodedSize,
              contentStatus: 'stored',
          };
};

const JSON_FEED_VERSIONS = new Set([
    'https://jsonfeed.org/version/1',
    'https://jsonfeed.org/version/1.1',
]);
const JSON_FEED_MIME_TYPES = new Set([
    'application/feed+json',
    'application/json',
]);
const jsonText = (value: unknown): string | undefined => {
    if (typeof value !== 'string') {
        return undefined;
    }
    const text = value.trim();
    return text === '' ? undefined : text;
};

const jsonContent = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() !== '' ? value : undefined;

const jsonAuthor = (container: XmlRecord): string | undefined => {
    if (Array.isArray(container.authors)) {
        for (const value of container.authors) {
            const name = jsonText(record(value)?.name);
            if (name !== undefined) {
                return boundedText(name, 1_000);
            }
        }
    }
    return boundedText(jsonText(record(container.author)?.name), 1_000);
};

const candidateFromJsonItem = (
    value: unknown,
    sourceIndex: number,
    finalUrl: URL,
    fetchedAt: number,
    feedAuthor: string | undefined,
): EntryCandidate | undefined => {
    const item = record(value);
    if (item === undefined) {
        return undefined;
    }

    const sourceId = jsonText(item.id);
    if (sourceId === undefined || sourceId.length > 4_096) {
        return undefined;
    }

    const contentHtml = jsonContent(item.content_html);
    const contentText = jsonContent(item.content_text);
    if (contentHtml === undefined && contentText === undefined) {
        return undefined;
    }
    const content = normalizedContent(
        contentHtml ??
            (contentText === undefined ? undefined : escaped(contentText)),
        finalUrl,
    );
    const rawTitle = plainTextTitle(jsonText(item.title), 2_000);
    const itemAuthor = jsonAuthor(item);
    const rawPublished = jsonText(item.date_published);
    const rawUpdated = jsonText(item.date_modified);
    const dates = entryDateSelection(rawPublished, rawUpdated, fetchedAt);
    if (dates === undefined) {
        return undefined;
    }
    const { published, sourceUpdatedAt } = dates;
    const url =
        resolveHttpUrl(jsonText(item.url), finalUrl) ??
        resolveHttpUrl(jsonText(item.external_url), finalUrl);

    return {
        sourceIdentity: `id:${sourceId}`,
        sourceId,
        title: rawTitle ?? 'Untitled',
        url,
        author: itemAuthor ?? feedAuthor ?? null,
        publishedAt: published ?? sourceUpdatedAt ?? fetchedAt,
        sourceUpdatedAt,
        sortTimestamp: published ?? sourceUpdatedAt,
        ...content,
        updateMask: {
            title: rawTitle !== undefined,
            url: url !== null,
            author: itemAuthor !== undefined,
            publishedAt: published !== null,
            sourceUpdatedAt: sourceUpdatedAt !== null,
            content: true,
        },
        sourceIndex,
    };
};

const jsonFeed = (
    document: unknown,
    finalUrl: URL,
    fetchedAt: number,
): {
    readonly metadata: NormalizedFeedMetadata;
    readonly candidates: readonly EntryCandidate[];
} => {
    const feed = record(document);
    const version = jsonText(feed?.version);
    const title = jsonText(feed?.title);
    if (
        feed === undefined ||
        version === undefined ||
        !JSON_FEED_VERSIONS.has(version) ||
        title === undefined ||
        !Array.isArray(feed.items)
    ) {
        throw new FeedParseError({ reason: 'unsupported_feed' });
    }

    if (feed.items.length > MAX_FEED_ITEMS_TO_PARSE) {
        throw new FeedParseError({ reason: 'too_many_entries' });
    }

    const metadata: NormalizedFeedMetadata = {
        title: plainTextTitle(title, 500) ?? finalUrl.hostname,
        siteUrl: resolveHttpUrl(jsonText(feed.home_page_url), finalUrl),
        faviconUrl:
            resolveHttpUrl(jsonText(feed.favicon), finalUrl) ??
            resolveHttpUrl(jsonText(feed.icon), finalUrl),
        description: boundedText(jsonText(feed.description), 4_000) ?? null,
        sourceUpdatedAt: null,
    };
    const feedAuthor = jsonAuthor(feed);
    const candidates = feed.items
        .map((item, sourceIndex) =>
            candidateFromJsonItem(
                item,
                sourceIndex,
                finalUrl,
                fetchedAt,
                feedAuthor,
            ),
        )
        .filter(
            (candidate): candidate is EntryCandidate => candidate !== undefined,
        );

    return { metadata, candidates };
};

const candidateFromItem = (
    kind: FeedKind,
    value: unknown,
    sourceIndex: number,
    finalUrl: URL,
    fetchedAt: number,
): EntryCandidate | undefined => {
    const item = record(value);
    if (item === undefined) {
        return undefined;
    }

    const rawSourceId =
        firstText(item, 'guid', 'id') ?? scalarText(item['@_about']) ?? null;
    const sourceId = boundedText(rawSourceId ?? undefined, 4_096) ?? null;
    const url = itemLink(kind, item, finalUrl);
    const rawTitle = plainTextTitle(firstText(item, 'title'), 2_000);
    const title = rawTitle ?? 'Untitled';
    const rawContent = contentForItem(item);
    const contentProvided = [
        'encoded',
        'content',
        'description',
        'summary',
    ].some((key) => Object.hasOwn(item, key));
    const content = normalizedContent(rawContent, finalUrl);
    const rawPublished = firstText(item, 'pubdate', 'published', 'date');
    const rawUpdated = firstText(item, 'updated', 'modified');
    const dates = entryDateSelection(rawPublished, rawUpdated, fetchedAt);
    if (dates === undefined) {
        return undefined;
    }
    const { published, sourceUpdatedAt } = dates;

    if (
        sourceId === null &&
        url === null &&
        title === 'Untitled' &&
        content.contentStatus === 'empty' &&
        rawPublished === undefined &&
        rawUpdated === undefined
    ) {
        return undefined;
    }

    // The fallback includes only stable source fields. It deliberately excludes
    // fetch time and source order so retries and feed reordering deduplicate.
    const fallback = [
        title,
        rawPublished ?? '',
        rawUpdated ?? '',
        rawContent?.slice(0, 4_096) ?? '',
    ].join('\n');
    const sourceIdentity =
        rawSourceId !== null
            ? `id:${rawSourceId}`
            : url !== null
              ? `url:${url}`
              : `fallback:${fallback}`;

    const author = boundedText(
        firstText(item, 'author', 'creator') ??
            scalarText(firstRecord(item.author)?.name),
        1_000,
    );
    return {
        sourceIdentity,
        sourceId,
        title,
        url,
        author: author ?? null,
        publishedAt: published ?? sourceUpdatedAt ?? fetchedAt,
        sourceUpdatedAt,
        sortTimestamp: published ?? sourceUpdatedAt,
        ...content,
        updateMask: {
            title: rawTitle !== undefined,
            url: url !== null,
            author: author !== undefined,
            publishedAt: published !== null,
            sourceUpdatedAt: sourceUpdatedAt !== null,
            content: contentProvided,
        },
        sourceIndex,
    };
};

const digestIdentity = async (
    identity: string,
    webCrypto: Crypto,
): Promise<Uint8Array> =>
    new Uint8Array(
        await webCrypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(identity),
        ),
    );

const entriesFromCandidates = async (
    candidates: readonly EntryCandidate[],
    webCrypto: Crypto,
): Promise<readonly NormalizedFeedEntry[]> => {
    const sorted = [...candidates].sort((left, right) => {
        if (left.sortTimestamp === null && right.sortTimestamp === null) {
            return left.sourceIndex - right.sourceIndex;
        }
        if (left.sortTimestamp === null) {
            return 1;
        }
        if (right.sortTimestamp === null) {
            return -1;
        }
        return (
            right.sortTimestamp - left.sortTimestamp ||
            left.sourceIndex - right.sourceIndex
        );
    });
    const entries: NormalizedFeedEntry[] = [];
    const seen = new Set<string>();
    for (const candidate of sorted) {
        const deduplicationKey = await digestIdentity(
            candidate.sourceIdentity,
            webCrypto,
        );
        const key = Array.from(deduplicationKey, (byte) =>
            byte.toString(16).padStart(2, '0'),
        ).join('');
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);

        const { sortTimestamp: _, sourceIndex: __, ...entry } = candidate;
        if (entries.length === MAX_FEED_ENTRIES) {
            throw new FeedParseError({ reason: 'too_many_entries' });
        }
        entries.push({
            ...entry,
            deduplicationKey,
        });
    }
    // D1 assigns sequence IDs in iteration order. Reverse only after selecting
    // and deduplicating newest-first so duplicate precedence stays unchanged,
    // while newer entries receive higher IDs within each refresh batch.
    return entries.reverse();
};

export const parseFeedDocument = async (
    bytes: Uint8Array,
    options: ParseFeedOptions,
): Promise<ParsedFeed> => {
    if (bytes.byteLength === 0) {
        throw new FeedParseError({ reason: 'empty_document' });
    }
    const decoded = new TextDecoder().decode(bytes);
    const source = decoded.startsWith('\ufeff') ? decoded.slice(1) : decoded;
    const contentType = options.contentType
        ?.split(';', 1)[0]
        .trim()
        .toLowerCase();
    const firstCharacter = source.trimStart().at(0);
    const isJson =
        (contentType !== undefined && JSON_FEED_MIME_TYPES.has(contentType)) ||
        firstCharacter === '{' ||
        firstCharacter === '[';

    let metadata: NormalizedFeedMetadata;
    let candidates: readonly EntryCandidate[];
    if (isJson) {
        let document: unknown;
        try {
            document = JSON.parse(source);
        } catch {
            throw new FeedParseError({ reason: 'malformed_json' });
        }
        ({ metadata, candidates } = jsonFeed(
            document,
            options.finalUrl,
            options.fetchedAt,
        ));
    } else {
        if (/<!\s*(?:doctype|entity)\b/iu.test(source)) {
            throw new FeedParseError({ reason: 'forbidden_declaration' });
        }

        let document: unknown;
        try {
            document = parser.parse(source, true);
        } catch {
            throw new FeedParseError({ reason: 'malformed_xml' });
        }

        const shape = feedShape(document);
        if (shape.items.length > MAX_FEED_ITEMS_TO_PARSE) {
            throw new FeedParseError({ reason: 'too_many_entries' });
        }
        metadata = metadataFromShape(
            shape,
            options.finalUrl,
            options.fetchedAt,
        );
        candidates = shape.items
            .map((item, sourceIndex) => {
                try {
                    return candidateFromItem(
                        shape.kind,
                        item,
                        sourceIndex,
                        options.finalUrl,
                        options.fetchedAt,
                    );
                } catch {
                    return undefined;
                }
            })
            .filter(
                (candidate): candidate is EntryCandidate =>
                    candidate !== undefined,
            );
    }

    const entries = await entriesFromCandidates(
        candidates,
        options.webCrypto ?? globalThis.crypto,
    );
    return { metadata, entries };
};
