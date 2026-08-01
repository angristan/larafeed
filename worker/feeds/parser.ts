import { XMLParser } from 'fast-xml-parser';

import { FeedParseError } from './errors';
import { MAX_CONTENT_BYTES, sanitizeArticleHtml } from './sanitize';

export const MAX_FEED_ENTRIES = 50;
export const MAX_FUTURE_DATE_SKEW_MS = 24 * 60 * 60 * 1_000;

export type ContentStatus = 'stored' | 'empty' | 'oversized';

export interface NormalizedFeedMetadata {
    readonly title: string;
    readonly siteUrl: string | null;
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
}

export interface ParsedFeed {
    readonly metadata: NormalizedFeedMetadata;
    readonly entries: readonly NormalizedFeedEntry[];
}

interface ParseFeedOptions {
    readonly finalUrl: URL;
    readonly fetchedAt: number;
    readonly webCrypto?: Crypto;
}

type XmlRecord = Record<string, unknown>;

type FeedKind = 'rss' | 'atom' | 'rdf';

interface FeedShape {
    readonly kind: FeedKind;
    readonly metadata: XmlRecord;
    readonly items: readonly unknown[];
}

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

const parseDate = (value: string | undefined, now: number): number | null => {
    if (value === undefined || value.length > 256) {
        return null;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) &&
        parsed >= 0 &&
        parsed <= now + MAX_FUTURE_DATE_SKEW_MS
        ? parsed
        : null;
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

const metadataFromShape = (
    shape: FeedShape,
    finalUrl: URL,
    fetchedAt: number,
): NormalizedFeedMetadata => {
    const title =
        boundedText(firstText(shape.metadata, 'title'), 500) ??
        finalUrl.hostname;
    const siteUrl =
        shape.kind === 'atom'
            ? atomLink(shape.metadata.link, finalUrl, 'alternate')
            : resolveHttpUrl(firstText(shape.metadata, 'link'), finalUrl);
    const sourceUpdatedAt = parseDate(
        firstText(shape.metadata, 'updated', 'lastbuilddate', 'date'),
        fetchedAt,
    );

    return {
        title,
        siteUrl,
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

const candidateFromItem = (
    kind: FeedKind,
    value: unknown,
    sourceIndex: number,
    finalUrl: URL,
    fetchedAt: number,
    feedUpdatedAt: number | null,
): EntryCandidate | undefined => {
    const item = record(value);
    if (item === undefined) {
        return undefined;
    }

    const rawSourceId =
        firstText(item, 'guid', 'id') ?? scalarText(item['@_about']) ?? null;
    const sourceId = boundedText(rawSourceId ?? undefined, 4_096) ?? null;
    const url = itemLink(kind, item, finalUrl);
    const title = boundedText(firstText(item, 'title'), 2_000) ?? 'Untitled';
    const rawContent = contentForItem(item);
    const content = normalizedContent(rawContent, finalUrl);
    const rawPublished = firstText(item, 'pubdate', 'published', 'date');
    const rawUpdated = firstText(item, 'updated', 'modified');
    const published = parseDate(rawPublished, fetchedAt);
    const sourceUpdatedAt = parseDate(rawUpdated, fetchedAt);

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

    return {
        sourceIdentity,
        sourceId,
        title,
        url,
        author:
            boundedText(
                firstText(item, 'author', 'creator') ??
                    scalarText(firstRecord(item.author)?.name),
                1_000,
            ) ?? null,
        publishedAt: published ?? sourceUpdatedAt ?? feedUpdatedAt ?? fetchedAt,
        sourceUpdatedAt,
        sortTimestamp: published ?? sourceUpdatedAt,
        ...content,
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

export const parseFeedDocument = async (
    bytes: Uint8Array,
    options: ParseFeedOptions,
): Promise<ParsedFeed> => {
    if (bytes.byteLength === 0) {
        throw new FeedParseError({ reason: 'empty_document' });
    }
    const source = new TextDecoder().decode(bytes);
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
    const metadata = metadataFromShape(
        shape,
        options.finalUrl,
        options.fetchedAt,
    );
    const candidates = shape.items
        .map((item, sourceIndex) => {
            try {
                return candidateFromItem(
                    shape.kind,
                    item,
                    sourceIndex,
                    options.finalUrl,
                    options.fetchedAt,
                    metadata.sourceUpdatedAt,
                );
            } catch {
                return undefined;
            }
        })
        .filter(
            (candidate): candidate is EntryCandidate => candidate !== undefined,
        )
        .sort((left, right) => {
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
    const webCrypto = options.webCrypto ?? globalThis.crypto;
    for (const candidate of candidates) {
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
        entries.push({ ...entry, deduplicationKey });
        if (entries.length === MAX_FEED_ENTRIES) {
            break;
        }
    }

    return { metadata, entries };
};
