import { validateFeedUrl } from '../feeds/policy';

export const MAX_ARTICLE_IMAGES = 100;

const fallbackBase = new URL('https://invalid.larafeed.local/');

const sourceUrl = (value: string, baseUrl: string | null): string | null => {
    try {
        const base = baseUrl === null ? fallbackBase : validateFeedUrl(baseUrl);
        return validateFeedUrl(new URL(value, base)).href;
    } catch {
        return null;
    }
};

export const articleImagePath = (entryId: number, imageIndex: number): string =>
    `/api/images/entries/${entryId}/${imageIndex}`;

export const rewriteArticleImageUrls = async (
    entryId: number,
    html: string,
    baseUrl: string | null,
): Promise<string> => {
    let imageIndex = 0;
    const response = new HTMLRewriter()
        .on('img', {
            element(element) {
                const source = element.getAttribute('src');
                if (source === null || sourceUrl(source, baseUrl) === null) {
                    element.removeAttribute('src');
                    return;
                }

                imageIndex += 1;
                if (imageIndex > MAX_ARTICLE_IMAGES) {
                    element.removeAttribute('src');
                    return;
                }
                element.setAttribute(
                    'src',
                    articleImagePath(entryId, imageIndex),
                );
            },
        })
        .transform(
            new Response(html, {
                headers: { 'content-type': 'text/html; charset=UTF-8' },
            }),
        );
    return response.text();
};

export const findArticleImageSource = async (
    html: string,
    baseUrl: string | null,
    requestedIndex: number,
): Promise<string | null> => {
    if (
        !Number.isSafeInteger(requestedIndex) ||
        requestedIndex < 1 ||
        requestedIndex > MAX_ARTICLE_IMAGES
    ) {
        return null;
    }

    let imageIndex = 0;
    let selected: string | null = null;
    const response = new HTMLRewriter()
        .on('img', {
            element(element) {
                if (selected !== null) return;
                const source = element.getAttribute('src');
                if (source === null) return;
                const resolved = sourceUrl(source, baseUrl);
                if (resolved === null) return;

                imageIndex += 1;
                if (imageIndex === requestedIndex) selected = resolved;
            },
        })
        .transform(
            new Response(html, {
                headers: { 'content-type': 'text/html; charset=UTF-8' },
            }),
        );
    await response.arrayBuffer();
    return selected;
};
