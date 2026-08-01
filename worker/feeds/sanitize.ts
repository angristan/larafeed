export const MAX_CONTENT_BYTES = 1_800_000;

const blockedElements = new Set([
    'base',
    'embed',
    'form',
    'iframe',
    'link',
    'meta',
    'object',
    'script',
    'style',
]);

const blockedVoidElements = new Set(['base', 'embed', 'link', 'meta']);

const allowedElements = new Set([
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
]);

const voidElements = new Set(['br', 'hr', 'img']);
const urlAttributes = new Set(['cite', 'href', 'src']);
const globalAttributes = new Set(['dir', 'lang', 'title']);
const elementAttributes: Readonly<Record<string, ReadonlySet<string>>> = {
    a: new Set(['href']),
    blockquote: new Set(['cite']),
    img: new Set(['alt', 'height', 'src', 'width']),
    ol: new Set(['start']),
    q: new Set(['cite']),
    td: new Set(['colspan', 'rowspan']),
    th: new Set(['colspan', 'rowspan']),
    time: new Set(['datetime']),
};

const namedEntities: Readonly<Record<string, string>> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    quot: '"',
};

const decodeEntities = (value: string): string =>
    value.replace(
        /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z][a-z0-9]+));?/giu,
        (match, decimal: string, hexadecimal: string, named: string) => {
            if (decimal !== undefined) {
                const codePoint = Number.parseInt(decimal, 10);
                return codePoint <= 0x10ffff
                    ? String.fromCodePoint(codePoint)
                    : '\ufffd';
            }
            if (hexadecimal !== undefined) {
                const codePoint = Number.parseInt(hexadecimal, 16);
                return codePoint <= 0x10ffff
                    ? String.fromCodePoint(codePoint)
                    : '\ufffd';
            }
            return namedEntities[named.toLowerCase()] ?? match;
        },
    );

const escapeText = (value: string): string =>
    decodeEntities(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');

const escapeAttribute = (value: string): string =>
    escapeText(value).replaceAll('"', '&quot;');

const tagEnd = (html: string, start: number): number => {
    let quote = '';
    for (let index = start; index < html.length; index += 1) {
        const character = html[index];
        if (quote !== '') {
            if (character === quote) {
                quote = '';
            }
        } else if (character === '"' || character === "'") {
            quote = character;
        } else if (character === '>') {
            return index;
        }
    }
    return -1;
};

interface ParsedTag {
    readonly name: string;
    readonly closing: boolean;
    readonly selfClosing: boolean;
    readonly attributesText: string;
}

const parseTag = (source: string): ParsedTag | undefined => {
    const match = /^\s*(\/)?\s*([a-z][a-z0-9:-]*)/iu.exec(source);
    if (match === null) {
        return undefined;
    }

    const name = match[2].split(':').at(-1)?.toLowerCase();
    if (name === undefined) {
        return undefined;
    }

    return {
        name,
        closing: match[1] !== undefined,
        selfClosing: /\/\s*$/u.test(source),
        attributesText: source.slice(match[0].length),
    };
};

const parseAttributes = (
    source: string,
): readonly (readonly [string, string])[] => {
    const attributes: [string, string][] = [];
    let index = 0;

    while (index < source.length) {
        while (/\s|\//u.test(source[index] ?? '')) {
            index += 1;
        }
        const nameMatch = /^[^\s=/>]+/u.exec(source.slice(index));
        if (nameMatch === null) {
            break;
        }
        const name = nameMatch[0].toLowerCase();
        index += nameMatch[0].length;

        while (/\s/u.test(source[index] ?? '')) {
            index += 1;
        }
        let value = '';
        if (source[index] === '=') {
            index += 1;
            while (/\s/u.test(source[index] ?? '')) {
                index += 1;
            }
            const quote = source[index];
            if (quote === '"' || quote === "'") {
                index += 1;
                const end = source.indexOf(quote, index);
                if (end === -1) {
                    value = source.slice(index);
                    index = source.length;
                } else {
                    value = source.slice(index, end);
                    index = end + 1;
                }
            } else {
                const valueMatch = /^[^\s>]+/u.exec(source.slice(index));
                value = valueMatch?.[0] ?? '';
                index += value.length;
            }
        }
        attributes.push([name, decodeEntities(value)]);
    }

    return attributes;
};

const safeUrl = (
    value: string,
    attribute: string,
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
        attribute === 'src' &&
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
        attribute === 'href'
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

const sanitizedAttributes = (
    tag: string,
    source: string,
    baseUrl: URL,
    allowDataImages: boolean,
): string => {
    const seen = new Set<string>();
    const output: string[] = [];

    for (const [name, rawValue] of parseAttributes(source)) {
        if (
            seen.has(name) ||
            name === 'style' ||
            name === 'srcdoc' ||
            name.startsWith('on') ||
            !(
                globalAttributes.has(name) ||
                elementAttributes[tag]?.has(name) === true
            )
        ) {
            continue;
        }
        seen.add(name);

        let value = rawValue;
        if (urlAttributes.has(name)) {
            const url = safeUrl(rawValue, name, baseUrl, allowDataImages);
            if (url === undefined) {
                continue;
            }
            value = url;
        } else if (name === 'dir' && !/^(?:auto|ltr|rtl)$/iu.test(value)) {
            continue;
        } else if (
            ['colspan', 'height', 'rowspan', 'start', 'width'].includes(name) &&
            !/^\d{1,4}$/u.test(value)
        ) {
            continue;
        }

        output.push(` ${name}="${escapeAttribute(value)}"`);
    }

    return output.join('');
};

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
    const blockedStack: string[] = [];
    const openElements: string[] = [];
    const output: string[] = [];
    let cursor = 0;

    while (cursor < html.length) {
        const start = html.indexOf('<', cursor);
        if (start === -1) {
            if (blockedStack.length === 0) {
                output.push(escapeText(html.slice(cursor)));
            }
            break;
        }
        if (blockedStack.length === 0) {
            output.push(escapeText(html.slice(cursor, start)));
        }

        if (html.startsWith('<!--', start)) {
            const commentEnd = html.indexOf('-->', start + 4);
            cursor = commentEnd === -1 ? html.length : commentEnd + 3;
            continue;
        }

        const end = tagEnd(html, start + 1);
        if (end === -1) {
            if (blockedStack.length === 0) {
                output.push('&lt;');
            }
            cursor = start + 1;
            continue;
        }

        const tag = parseTag(html.slice(start + 1, end));
        cursor = end + 1;
        if (tag === undefined) {
            continue;
        }

        if (blockedStack.length > 0) {
            if (tag.closing && tag.name === blockedStack.at(-1)) {
                blockedStack.pop();
            } else if (
                !tag.closing &&
                !tag.selfClosing &&
                blockedElements.has(tag.name)
            ) {
                blockedStack.push(tag.name);
            }
            continue;
        }

        if (blockedElements.has(tag.name)) {
            if (
                !tag.closing &&
                !tag.selfClosing &&
                !blockedVoidElements.has(tag.name)
            ) {
                blockedStack.push(tag.name);
            }
            continue;
        }
        if (!allowedElements.has(tag.name)) {
            continue;
        }

        if (tag.closing) {
            const matchingIndex = openElements.lastIndexOf(tag.name);
            if (matchingIndex === -1) {
                continue;
            }
            for (
                let index = openElements.length - 1;
                index >= matchingIndex;
                index -= 1
            ) {
                output.push(`</${openElements[index]}>`);
            }
            openElements.length = matchingIndex;
            continue;
        }

        const attributes = sanitizedAttributes(
            tag.name,
            tag.attributesText,
            base,
            allowDataImages,
        );
        output.push(`<${tag.name}${attributes}>`);
        if (!tag.selfClosing && !voidElements.has(tag.name)) {
            openElements.push(tag.name);
        }
    }

    for (let index = openElements.length - 1; index >= 0; index -= 1) {
        output.push(`</${openElements[index]}>`);
    }

    return output.join('').trim();
};
