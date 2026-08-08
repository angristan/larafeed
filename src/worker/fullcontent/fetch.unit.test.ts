import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { makeArticlePageFetcher } from './fetch';

const htmlResponse = (
    body: string,
    headers: Record<string, string> = {},
): Response =>
    new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
    });

const run = (fetcher: ReturnType<typeof makeArticlePageFetcher>, url: string) =>
    Effect.runPromise(fetcher(url));

const failure = async (
    fetcher: ReturnType<typeof makeArticlePageFetcher>,
    url: string,
) => Effect.runPromise(Effect.flip(fetcher(url)));

describe('makeArticlePageFetcher', () => {
    it('fetches and decodes an article page', async () => {
        const fetch = vi.fn(() =>
            Promise.resolve(htmlResponse('<html>héllo</html>')),
        );
        const page = await run(
            makeArticlePageFetcher({ fetch }),
            'https://example.test/article',
        );
        expect(page.html).toBe('<html>héllo</html>');
        expect(page.finalUrl.href).toBe('https://example.test/article');
    });

    it('follows redirects and reports the final URL', async () => {
        const fetch = vi.fn((input: RequestInfo | URL) => {
            const url = input instanceof URL ? input.href : String(input);
            if (url === 'https://example.test/a') {
                return Promise.resolve(
                    new Response(null, {
                        status: 301,
                        headers: { location: 'https://example.test/b' },
                    }),
                );
            }
            return Promise.resolve(htmlResponse('<html>final</html>'));
        });
        const page = await run(
            makeArticlePageFetcher({ fetch }),
            'https://example.test/a',
        );
        expect(page.finalUrl.href).toBe('https://example.test/b');
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('rejects redirects to forbidden addresses', async () => {
        const fetch = vi.fn(() =>
            Promise.resolve(
                new Response(null, {
                    status: 302,
                    headers: { location: 'http://169.254.169.254/latest' },
                }),
            ),
        );
        const error = await failure(
            makeArticlePageFetcher({ fetch }),
            'https://example.test/a',
        );
        expect(error.kind).toBe('policy');
    });

    it('rejects private target URLs before fetching', async () => {
        const fetch = vi.fn();
        const error = await failure(
            makeArticlePageFetcher({ fetch }),
            'http://192.168.1.10/article',
        );
        expect(error.kind).toBe('policy');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('maps HTTP failures with their status', async () => {
        const fetch = vi.fn(() =>
            Promise.resolve(new Response('gone', { status: 410 })),
        );
        const error = await failure(
            makeArticlePageFetcher({ fetch }),
            'https://example.test/a',
        );
        expect(error.kind).toBe('http');
        expect(error.status).toBe(410);
    });

    it('rejects non-HTML content types', async () => {
        const fetch = vi.fn(() =>
            Promise.resolve(
                new Response('%PDF-', {
                    status: 200,
                    headers: { 'content-type': 'application/pdf' },
                }),
            ),
        );
        const error = await failure(
            makeArticlePageFetcher({ fetch }),
            'https://example.test/a',
        );
        expect(error.kind).toBe('unsupported_content');
    });

    it('rejects oversized declared bodies', async () => {
        const fetch = vi.fn(() =>
            Promise.resolve(
                htmlResponse('x', {
                    'content-length': String(11 * 1024 * 1024),
                }),
            ),
        );
        const error = await failure(
            makeArticlePageFetcher({ fetch }),
            'https://example.test/a',
        );
        expect(error.kind).toBe('too_large');
    });
});
