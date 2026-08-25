import type { Nodes, Properties } from 'hast';
import { fromHtml } from 'hast-util-from-html';
import { type Schema, sanitize } from 'hast-util-sanitize';
import { toHtml } from 'hast-util-to-html';

export const MAX_CONTENT_BYTES = 1_800_000;

const blockedElements = [
    'base',
    'embed',
    'form',
    'iframe',
    'link',
    'meta',
    'object',
    'script',
    'style',
];

const allowedElements = [
    'a',
    'b',
    'blockquote',
    'br',
    'caption',
    'cite',
    'code',
    'dd',
    'del',
    'details',
    'div',
    'dl',
    'dt',
    'em',
    'figcaption',
    'figure',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'i',
    'img',
    'ins',
    'kbd',
    'li',
    'mark',
    'ol',
    'p',
    'pre',
    'q',
    's',
    'samp',
    'small',
    'span',
    'strong',
    'sub',
    'summary',
    'sup',
    'table',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'time',
    'tr',
    'u',
    'ul',
    'var',
];

const allowedAttributes: NonNullable<Schema['attributes']> = {
    '*': ['dir', 'lang', 'title'],
    a: ['href'],
    blockquote: ['cite'],
    img: ['alt', 'height', 'src', 'width'],
    ol: ['start'],
    q: ['cite'],
    td: ['colSpan', 'rowSpan'],
    th: ['colSpan', 'rowSpan'],
    time: ['dateTime'],
};

const urlProperties = new Set(['cite', 'href', 'src']);
const numericProperties = new Set([
    'colSpan',
    'height',
    'rowSpan',
    'start',
    'width',
]);

const safeUrl = (
    value: string,
    property: string,
    baseUrl: URL,
    allowDataImages: boolean,
): string | undefined => {
    const normalizedScheme = Array.from(value.trim())
        .filter((character) => {
            const codePoint = character.codePointAt(0) ?? 0;
            return codePoint > 0x20 && codePoint !== 0x7f;
        })
        .join('');
    if (
        property === 'src' &&
        allowDataImages &&
        /^data:image\/(?:gif|jpeg|png|webp);base64,[a-z0-9+/=\s]+$/iu.test(
            normalizedScheme,
        )
    ) {
        return normalizedScheme.replace(/\s+/gu, '');
    }

    let url: URL;
    try {
        url = new URL(value.trim(), baseUrl);
    } catch {
        return undefined;
    }

    const allowedProtocols =
        property === 'href'
            ? new Set(['http:', 'https:', 'mailto:'])
            : new Set(['http:', 'https:']);
    if (!allowedProtocols.has(url.protocol.toLowerCase())) {
        return undefined;
    }
    if (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        (url.username !== '' || url.password !== '')
    ) {
        return undefined;
    }
    return url.href;
};

const normalizeTagNames = (node: Nodes): void => {
    if (node.type === 'element') {
        // Feed XHTML sometimes retains namespace prefixes. Match the previous
        // policy by applying the allowlist to the local element name.
        node.tagName =
            node.tagName.split(':').at(-1)?.toLowerCase() ?? node.tagName;
    }
    if ('children' in node) {
        for (const child of node.children) normalizeTagNames(child);
    }
};

const sanitizedProperties = (
    properties: Properties,
    baseUrl: URL,
    allowDataImages: boolean,
): Properties => {
    const result = { ...properties };
    for (const [name, rawValue] of Object.entries(result)) {
        if (rawValue === null || rawValue === undefined) {
            delete result[name];
            continue;
        }
        const value = String(rawValue);
        if (urlProperties.has(name)) {
            const url = safeUrl(value, name, baseUrl, allowDataImages);
            if (url === undefined) delete result[name];
            else result[name] = url;
        } else if (name === 'dir' && !/^(?:auto|ltr|rtl)$/iu.test(value)) {
            delete result[name];
        } else if (numericProperties.has(name) && !/^\d{1,4}$/u.test(value)) {
            delete result[name];
        }
    }
    return result;
};

const normalizeProperties = (
    node: Nodes,
    baseUrl: URL,
    allowDataImages: boolean,
): void => {
    if (node.type === 'element') {
        node.properties = sanitizedProperties(
            node.properties,
            baseUrl,
            allowDataImages,
        );
    }
    if ('children' in node) {
        for (const child of node.children) {
            normalizeProperties(child, baseUrl, allowDataImages);
        }
    }
};

const schema = (allowDataImages: boolean): Schema => ({
    allowComments: false,
    allowDoctypes: false,
    attributes: allowedAttributes,
    protocols: {
        cite: ['http', 'https'],
        href: ['http', 'https', 'mailto'],
        src: allowDataImages ? ['http', 'https', 'data'] : ['http', 'https'],
    },
    strip: blockedElements,
    tagNames: allowedElements,
});

export interface SanitizeHtmlOptions {
    readonly allowDataImages?: boolean;
}

export const sanitizeArticleHtml = (
    html: string,
    baseUrl: string | URL,
    options: SanitizeHtmlOptions = {},
): string => {
    const base = baseUrl instanceof URL ? baseUrl : new URL(baseUrl);
    const allowDataImages = options.allowDataImages === true;
    const tree = fromHtml(html, { fragment: true });
    normalizeTagNames(tree);

    const sanitized = sanitize(tree, schema(allowDataImages));
    normalizeProperties(sanitized, base, allowDataImages);
    return toHtml(sanitized, {
        characterReferences: { useNamedReferences: true },
    }).trim();
};
