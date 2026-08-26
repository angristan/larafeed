import { describe, expect, it } from 'vitest';

import {
    articleImagePath,
    findArticleImageSource,
    MAX_ARTICLE_IMAGES,
    rewriteArticleImageUrls,
} from './article';

describe('article image privacy', () => {
    it('rewrites safe absolute and relative sources to opaque owned paths', async () => {
        const html =
            '<p><img src="https://cdn.example.test/a.jpg" alt="a"><img src="/b.png"><img src="javascript:bad()"></p>';

        await expect(
            rewriteArticleImageUrls(
                42,
                html,
                'https://publisher.example.test/posts/one',
            ),
        ).resolves.toBe(
            `<p><img src="${articleImagePath(42, 1)}" alt="a"><img src="${articleImagePath(42, 2)}"><img></p>`,
        );
        await expect(
            findArticleImageSource(
                html,
                'https://publisher.example.test/posts/one',
                1,
            ),
        ).resolves.toBe('https://cdn.example.test/a.jpg');
        await expect(
            findArticleImageSource(
                html,
                'https://publisher.example.test/posts/one',
                2,
            ),
        ).resolves.toBe('https://publisher.example.test/b.png');
        await expect(
            findArticleImageSource(
                html,
                'https://publisher.example.test/posts/one',
                3,
            ),
        ).resolves.toBeNull();
    });

    it('decodes escaped query separators in sanitized image URLs', async () => {
        await expect(
            findArticleImageSource(
                '<img src="https://www.phoronix.net/image.php?id=2026&amp;image=gfx1250_strict_1">',
                'https://www.phoronix.com/news/AMD-gfx1250-strict',
                1,
            ),
        ).resolves.toBe(
            'https://www.phoronix.net/image.php?id=2026&image=gfx1250_strict_1',
        );
    });

    it('fails closed after the bounded image count', async () => {
        const html = Array.from(
            { length: MAX_ARTICLE_IMAGES + 1 },
            (_, index) => `<img src="https://cdn.example.test/${index}.png">`,
        ).join('');
        const rewritten = await rewriteArticleImageUrls(
            7,
            html,
            'https://publisher.example.test/post',
        );

        expect(rewritten).toContain(articleImagePath(7, MAX_ARTICLE_IMAGES));
        expect(rewritten).not.toContain(
            articleImagePath(7, MAX_ARTICLE_IMAGES + 1),
        );
        expect(rewritten).not.toContain('cdn.example.test');
    });
});
