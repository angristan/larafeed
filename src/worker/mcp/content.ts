/*
 * Converts stored article HTML to readable plain text for MCP clients.
 *
 * Entry HTML is already sanitized at ingestion, so this only has to keep the
 * structure a language model needs (paragraphs, headings, list items, link
 * targets, image alt text) while dropping markup that costs tokens. It uses the
 * Workers HTMLRewriter, so it streams and never builds a DOM.
 */

const BLOCK_ELEMENTS = [
    'p',
    'div',
    'section',
    'article',
    'header',
    'footer',
    'aside',
    'blockquote',
    'figure',
    'figcaption',
    'table',
    'tr',
    'ul',
    'ol',
    'dl',
    'dt',
    'dd',
    'hr',
].join(', ');

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ndash: '–',
    mdash: '—',
    hellip: '…',
    lsquo: '‘',
    rsquo: '’',
    ldquo: '“',
    rdquo: '”',
    laquo: '«',
    raquo: '»',
    copy: '©',
    reg: '®',
    trade: '™',
};

const ENTITY_PATTERN = /&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/giu;

/** Decodes the entities HTMLRewriter leaves in raw text chunks. */
export const decodeHtmlEntities = (text: string): string =>
    text.replace(ENTITY_PATTERN, (match, body: string) => {
        if (body.startsWith('#')) {
            const codePoint =
                body[1]?.toLowerCase() === 'x'
                    ? Number.parseInt(body.slice(2), 16)
                    : Number.parseInt(body.slice(1), 10);
            return Number.isInteger(codePoint) &&
                codePoint > 0 &&
                codePoint <= 0x10_ffff
                ? String.fromCodePoint(codePoint)
                : match;
        }
        return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    });

const isWebLink = (href: string): boolean => /^https?:\/\//iu.test(href);

/**
 * Runs `callback` at the element's end tag. Void elements such as `<hr>` and
 * self-closing tags have none, and HTMLRewriter throws if asked; for those the
 * callback runs right away.
 */
const atEndTag = (element: Element, callback: () => void): void => {
    try {
        element.onEndTag(callback);
    } catch {
        // "Parser error: No end tag." The element ends where it starts.
        callback();
    }
};

export const htmlToText = async (html: string): Promise<string> => {
    const parts: string[] = [];
    let preformattedDepth = 0;
    // True at the start of output or after whitespace, where HTML would not
    // render another space.
    const afterWhitespace = (): boolean => {
        const last = parts.at(-1);
        return last === undefined || /\s$/u.test(last);
    };

    const rewriter = new HTMLRewriter()
        .on(BLOCK_ELEMENTS, {
            element(element) {
                parts.push('\n\n');
                atEndTag(element, () => {
                    parts.push('\n\n');
                });
            },
        })
        .on('h1, h2, h3, h4, h5, h6', {
            element(element) {
                const level = Number(element.tagName.slice(1));
                parts.push(`\n\n${'#'.repeat(level)} `);
                atEndTag(element, () => {
                    parts.push('\n\n');
                });
            },
        })
        .on('pre', {
            element(element) {
                preformattedDepth += 1;
                parts.push('\n\n```\n');
                atEndTag(element, () => {
                    preformattedDepth -= 1;
                    parts.push('\n```\n\n');
                });
            },
        })
        .on('li', {
            element() {
                parts.push('\n- ');
            },
        })
        .on('br', {
            element() {
                parts.push('\n');
            },
        })
        .on('a[href]', {
            element(element) {
                const href = element.getAttribute('href') ?? '';
                atEndTag(element, () => {
                    if (isWebLink(href)) parts.push(` (${href})`);
                });
            },
        })
        .on('img[alt]', {
            element(element) {
                const alt = element.getAttribute('alt')?.trim() ?? '';
                if (alt.length > 0) {
                    parts.push(`[image: ${decodeHtmlEntities(alt)}]`);
                }
            },
        })
        .onDocument({
            text(chunk) {
                const text = decodeHtmlEntities(chunk.text);
                if (preformattedDepth > 0) {
                    parts.push(text);
                    return;
                }
                // Outside <pre>, HTML whitespace collapses to one space, and
                // whitespace right after a block break is not rendered.
                const collapsed = text.replace(/[ \t\r\n\f]+/gu, ' ');
                const inline = afterWhitespace()
                    ? collapsed.trimStart()
                    : collapsed;
                if (inline.length > 0) parts.push(inline);
            },
        });

    // The rewriter only runs while its output is consumed. If it still fails
    // on some markup, fall back to dropping tags: rough text beats an error
    // that would stall the search indexer or a whole page of excerpts.
    try {
        await rewriter.transform(new Response(html)).text();
    } catch {
        return decodeHtmlEntities(html.replace(/<[^>]*>/gu, ' '))
            .replace(/\s+/gu, ' ')
            .trim();
    }

    return parts
        .join('')
        .split('\n')
        .map((line) => line.trimEnd())
        .join('\n')
        .replace(/\n{3,}/gu, '\n\n')
        .trim();
};

export interface TruncatedText {
    readonly text: string;
    readonly truncated: boolean;
}

/**
 * Cuts text to at most `maxChars` characters plus an ellipsis, at a word
 * boundary when one is close to the limit.
 */
export const truncateText = (text: string, maxChars: number): TruncatedText => {
    if (text.length <= maxChars) return { text, truncated: false };
    let cut = text.slice(0, maxChars);
    // Do not leave half of a surrogate pair at the end.
    if (/[\uD800-\uDBFF]$/u.test(cut)) cut = cut.slice(0, -1);
    const lastBreak = cut.search(/\s\S*$/u);
    if (lastBreak > maxChars * 0.6) cut = cut.slice(0, lastBreak);
    return { text: `${cut.trimEnd()}…`, truncated: true };
};
