import { XMLParser } from 'fast-xml-parser';

import { OpmlValidationError } from './errors';
import {
    MAX_CATEGORY_SEGMENT_LENGTH,
    MAX_CUSTOM_TITLE_LENGTH,
    MAX_OPML_CHARACTERS,
    MAX_OPML_DEPTH,
    MAX_OPML_FEEDS,
    type ParsedOpmlItem,
} from './types';

type XmlRecord = Record<string, unknown>;

const parser = new XMLParser({
    allowBooleanAttributes: false,
    ignoreAttributes: false,
    ignoreDeclaration: true,
    ignorePiTags: true,
    maxNestedTags: MAX_OPML_DEPTH + 10,
    parseAttributeValue: false,
    parseTagValue: false,
    processEntities: {
        enabled: true,
        maxEntityCount: 0,
        maxEntitySize: 0,
        maxExpandedLength: 10_000,
        maxTotalExpansions: 100,
    },
    transformAttributeName: (name) => name.toLowerCase(),
    transformTagName: (name) => name.toLowerCase(),
    trimValues: true,
});

const record = (value: unknown): XmlRecord | undefined =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as XmlRecord)
        : undefined;

const records = (value: unknown): readonly XmlRecord[] => {
    const values = Array.isArray(value)
        ? value
        : value === undefined
          ? []
          : [value];
    return values
        .map(record)
        .filter((item): item is XmlRecord => item !== undefined);
};

const text = (value: unknown, maximum: number): string | null => {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const normalized = String(value).replace(/\s+/gu, ' ').trim();
    return normalized === '' ? null : normalized.slice(0, maximum);
};

const attribute = (
    node: XmlRecord,
    names: readonly string[],
    maximum: number,
): string | null => {
    for (const name of names) {
        const value = text(node[`@_${name}`] ?? node[name], maximum);
        if (value !== null) return value;
    }
    return null;
};

const normalizeFeedIdentity = (feedUrl: string): string => {
    try {
        return new URL(feedUrl).href;
    } catch {
        // Invalid URLs remain durable work items. Processing applies the strict
        // network URL policy and records a bounded, visible item failure.
        return feedUrl;
    }
};

const categorySegment = (node: XmlRecord): string | null =>
    attribute(node, ['title', 'text'], MAX_CATEGORY_SEGMENT_LENGTH);

export const parseOpml = (source: string): readonly ParsedOpmlItem[] => {
    if (source.length === 0 || source.length > MAX_OPML_CHARACTERS) {
        throw new OpmlValidationError('document_size');
    }
    if (/<!\s*(?:doctype|entity)\b/iu.test(source)) {
        throw new OpmlValidationError('forbidden_declaration');
    }

    let parsed: unknown;
    try {
        parsed = parser.parse(source, true);
    } catch {
        throw new OpmlValidationError('malformed_xml');
    }

    const document = record(parsed);
    const opml = record(document?.opml);
    const body = record(opml?.body);
    if (document === undefined || opml === undefined || body === undefined) {
        throw new OpmlValidationError('unsupported_document');
    }

    const items: ParsedOpmlItem[] = [];
    const seen = new Set<string>();

    const visit = (
        outlines: readonly XmlRecord[],
        categoryPath: readonly string[],
        depth: number,
    ): void => {
        if (depth > MAX_OPML_DEPTH) {
            throw new OpmlValidationError('outline_depth');
        }

        for (const outline of outlines) {
            const feedUrl = attribute(outline, ['xmlurl'], 16_384);
            const children = records(outline.outline);

            if (feedUrl !== null) {
                const normalizedFeedUrl = normalizeFeedIdentity(feedUrl);
                if (!seen.has(normalizedFeedUrl)) {
                    if (items.length >= MAX_OPML_FEEDS) {
                        throw new OpmlValidationError('too_many_feeds');
                    }
                    seen.add(normalizedFeedUrl);
                    items.push({
                        position: items.length,
                        title: attribute(outline, ['title', 'text'], 255),
                        customTitle: attribute(
                            outline,
                            ['customtitle'],
                            MAX_CUSTOM_TITLE_LENGTH,
                        ),
                        feedUrl,
                        normalizedFeedUrl,
                        siteUrl: attribute(outline, ['htmlurl'], 16_384),
                        categoryPath: [...categoryPath],
                    });
                }
            }

            if (children.length > 0) {
                const segment =
                    feedUrl === null ? categorySegment(outline) : null;
                visit(
                    children,
                    segment === null
                        ? categoryPath
                        : [...categoryPath, segment],
                    depth + 1,
                );
            }
        }
    };

    visit(records(body.outline), [], 0);
    return items;
};
