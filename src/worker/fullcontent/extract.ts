import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

export interface ExtractedArticle {
    readonly title: string | null;
    readonly html: string;
}

// Readability leaves relative URLs untouched when the document has no usable
// base; sanitizeArticleHtml resolves them against the article's final URL.
export const extractArticle = (html: string): ExtractedArticle | null => {
    try {
        const { document } = parseHTML(html);
        const result = new Readability(document, {
            charThreshold: 250,
        }).parse();
        if (result === null) return null;
        const content = result.content?.trim() ?? '';
        if (content.length === 0) return null;
        const title = result.title?.trim() ?? '';
        return { title: title.length === 0 ? null : title, html: content };
    } catch {
        return null;
    }
};
