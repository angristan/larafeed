import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    IMAGE_CACHE_TTL_SECONDS,
    IMAGE_FETCH_TIMEOUT_MS,
    MAX_IMAGE_RESPONSE_BYTES,
    makeImageService,
} from './service';

const bytes = (size = 8): ArrayBuffer => new Uint8Array(size).buffer;
const imageResponse = (size = 8, contentType = 'image/png') =>
    new Response(bytes(size), { headers: { 'content-type': contentType } });

const cacheUrl = (input: RequestInfo | URL): string => {
    if (typeof input === 'string') return input;
    return input instanceof URL ? input.href : input.url;
};

const makeCache = () => {
    const entries = new Map<string, Response>();
    const match = vi.fn(async (input: RequestInfo | URL) =>
        entries.get(cacheUrl(input))?.clone(),
    );
    const put = vi.fn(async (input: RequestInfo | URL, response: Response) => {
        entries.set(cacheUrl(input), response.clone());
    });
    const cache = {
        delete: vi.fn(async (input: RequestInfo | URL) =>
            entries.delete(cacheUrl(input)),
        ),
        match,
        put,
    } as unknown as Cache;
    return { cache, entries, match, put };
};

const makeImages = () => {
    const output = vi.fn(
        async (
            options: ImageOutputOptions,
        ): Promise<ImageTransformationResult> =>
            ({
                response: () =>
                    new Response(bytes(), {
                        headers: { 'content-type': options.format },
                    }),
                contentType: () => options.format,
                image: () =>
                    new ReadableStream<Uint8Array>({
                        start(controller) {
                            controller.enqueue(new Uint8Array(bytes()));
                            controller.close();
                        },
                    }),
            }) as ImageTransformationResult,
    );
    const transformer = {
        transform: vi.fn(),
        output,
    };
    transformer.transform.mockReturnValue(transformer);
    const images = {
        input: vi.fn(() => transformer),
    } as unknown as ImagesBinding;
    return { images, transformer, output };
};

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('feed image service', () => {
    it('applies only fixed presets with automatic safe output negotiation', async () => {
        const binding = makeImages();
        const fetch = vi.fn(async () => imageResponse());
        const service = makeImageService({
            images: binding.images,
            fetch: fetch as typeof globalThis.fetch,
        });

        await service.transformFeedImage({
            sourceUrl: 'https://images.example.test/icon.png',
            preset: 'small',
            accept: 'image/avif,image/webp,*/*',
        });
        await service.transformFeedImage({
            sourceUrl: 'https://images.example.test/icon.png',
            preset: 'medium',
            accept: 'image/webp,*/*',
        });
        await service.transformArticleImage({
            sourceUrl: 'https://images.example.test/article.png',
            accept: 'image/webp,*/*',
        });

        expect(binding.transformer.transform).toHaveBeenNthCalledWith(1, {
            width: 32,
            height: 32,
            fit: 'cover',
        });
        expect(binding.transformer.transform).toHaveBeenNthCalledWith(2, {
            width: 64,
            height: 64,
            fit: 'cover',
        });
        expect(binding.transformer.transform).toHaveBeenNthCalledWith(3, {
            width: 1_600,
            fit: 'scale-down',
        });
        expect(binding.output).toHaveBeenNthCalledWith(1, {
            format: 'image/avif',
            quality: 80,
            anim: false,
        });
        expect(binding.output).toHaveBeenNthCalledWith(2, {
            format: 'image/webp',
            quality: 80,
            anim: false,
        });
        expect(binding.output).toHaveBeenNthCalledWith(3, {
            format: 'image/webp',
            quality: 85,
            anim: false,
        });
        expect(fetch).toHaveBeenCalledWith(
            new URL('https://images.example.test/icon.png'),
            expect.objectContaining({ redirect: 'manual' }),
        );
    });

    it('reuses an opaque private transform cache after authorization inputs are resolved', async () => {
        const binding = makeImages();
        const cache = makeCache();
        const fetch = vi.fn(async () => imageResponse());
        const service = makeImageService({
            images: binding.images,
            fetch: fetch as typeof globalThis.fetch,
            cache: cache.cache,
            cacheOrigin: 'https://larafeed.example.test',
        });
        const input = {
            sourceUrl:
                'https://images.example.test/private/article.png?token=secret',
            accept: 'image/webp,*/*',
        };

        const first = await service.transformArticleImage(input);
        const second = await service.transformArticleImage(input);

        expect(await first.arrayBuffer()).toEqual(await second.arrayBuffer());
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(binding.images.input).toHaveBeenCalledTimes(1);
        expect(binding.transformer.transform).toHaveBeenCalledTimes(1);
        expect(cache.match).toHaveBeenCalledTimes(2);
        expect(cache.put).toHaveBeenCalledTimes(1);

        const key = cacheUrl(cache.match.mock.calls[0]?.[0] as Request);
        expect(key).toMatch(
            /^https:\/\/larafeed\.example\.test\/__larafeed-image-cache\/article-v1\/webp\/[a-f0-9]{64}$/u,
        );
        expect(key).not.toContain('images.example.test');
        expect(key).not.toContain('token');
        expect(key).not.toContain('secret');
        expect(second.headers.get('cache-control')).toBeNull();
        expect(cache.entries.get(key)?.headers.get('cache-control')).toBe(
            `max-age=${IMAGE_CACHE_TTL_SECONDS}`,
        );
    });

    it.each([
        'http://127.0.0.1/icon.png',
        'https://[::1]/icon.png',
        'https://user:secret@images.example.test/icon.png',
        'https://images.example.test:8443/icon.png',
        'https://images.example.test/icon.png#fragment',
        'file:///tmp/icon.png',
    ])('rejects unsafe stored source %s before any subrequest', async (sourceUrl) => {
        const binding = makeImages();
        const fetch = vi.fn();
        const service = makeImageService({
            images: binding.images,
            fetch: fetch as typeof globalThis.fetch,
        });

        await expect(
            service.transformFeedImage({
                sourceUrl,
                preset: 'small',
                accept: null,
            }),
        ).rejects.toMatchObject({ _tag: 'FeedImageUnavailable' });
        expect(fetch).not.toHaveBeenCalled();
        expect(binding.images.input).not.toHaveBeenCalled();
    });

    it('validates every redirect and permits at most three', async () => {
        const binding = makeImages();
        const responses = [
            new Response(null, {
                status: 302,
                headers: { location: '/one.png' },
            }),
            new Response(null, {
                status: 307,
                headers: { location: '/two.png' },
            }),
            new Response(null, {
                status: 308,
                headers: { location: '/three.png' },
            }),
            imageResponse(),
        ];
        const fetch = vi.fn(async () => {
            const response = responses.shift();
            if (response === undefined) throw new Error('missing fixture');
            return response;
        });
        const service = makeImageService({
            images: binding.images,
            fetch: fetch as typeof globalThis.fetch,
        });

        await expect(
            service.transformFeedImage({
                sourceUrl: 'https://images.example.test/start.png',
                preset: 'small',
                accept: null,
            }),
        ).resolves.toBeInstanceOf(Response);
        expect(fetch).toHaveBeenCalledTimes(4);

        const privateRedirectFetch = vi.fn(
            async () =>
                new Response(null, {
                    status: 302,
                    headers: { location: 'http://169.254.169.254/latest' },
                }),
        );
        await expect(
            makeImageService({
                images: binding.images,
                fetch: privateRedirectFetch as typeof globalThis.fetch,
            }).transformFeedImage({
                sourceUrl: 'https://images.example.test/start.png',
                preset: 'small',
                accept: null,
            }),
        ).rejects.toMatchObject({ _tag: 'FeedImageUnavailable' });
        expect(privateRedirectFetch).toHaveBeenCalledTimes(1);

        const endlessRedirectFetch = vi.fn(
            async () =>
                new Response(null, {
                    status: 302,
                    headers: { location: '/again.png' },
                }),
        );
        await expect(
            makeImageService({
                images: binding.images,
                fetch: endlessRedirectFetch as typeof globalThis.fetch,
            }).transformFeedImage({
                sourceUrl: 'https://images.example.test/start.png',
                preset: 'small',
                accept: null,
            }),
        ).rejects.toMatchObject({ _tag: 'FeedImageUnavailable' });
        expect(endlessRedirectFetch).toHaveBeenCalledTimes(4);
    });

    it('requires non-SVG image MIME and enforces header and stream caps', async () => {
        const binding = makeImages();
        for (const response of [
            imageResponse(8, 'image/svg+xml'),
            imageResponse(8, 'text/html'),
            new Response(bytes(), {
                headers: {
                    'content-type': 'image/png',
                    'content-length': String(MAX_IMAGE_RESPONSE_BYTES + 1),
                },
            }),
            new Response(
                new ReadableStream<Uint8Array>({
                    start(controller) {
                        controller.enqueue(
                            new Uint8Array(MAX_IMAGE_RESPONSE_BYTES),
                        );
                        controller.enqueue(new Uint8Array(1));
                        controller.close();
                    },
                }),
                { headers: { 'content-type': 'image/png' } },
            ),
        ]) {
            await expect(
                makeImageService({
                    images: binding.images,
                    fetch: (async () => response) as typeof globalThis.fetch,
                }).transformFeedImage({
                    sourceUrl: 'https://images.example.test/icon.png',
                    preset: 'small',
                    accept: null,
                }),
            ).rejects.toMatchObject({ _tag: 'FeedImageUnavailable' });
        }
        expect(binding.images.input).not.toHaveBeenCalled();
    });

    it('classifies retryable upstream failures without retrying permanent responses', async () => {
        const binding = makeImages();
        const input = {
            sourceUrl: 'https://images.example.test/icon.png',
            preset: 'small' as const,
            accept: null,
        };
        await expect(
            makeImageService({
                images: binding.images,
                fetch: (async () =>
                    new Response('unavailable', {
                        status: 503,
                    })) as typeof globalThis.fetch,
            }).transformFeedImage(input),
        ).rejects.toMatchObject({
            _tag: 'FeedImageUnavailable',
            retryable: true,
        });
        await expect(
            makeImageService({
                images: binding.images,
                fetch: (async () =>
                    new Response('missing', {
                        status: 404,
                    })) as typeof globalThis.fetch,
            }).transformFeedImage(input),
        ).rejects.toMatchObject({
            _tag: 'FeedImageUnavailable',
            retryable: false,
        });
    });

    it('uses one exact five-second timeout across the redirect chain', async () => {
        vi.useFakeTimers();
        const binding = makeImages();
        const fetch = vi.fn(
            async (_input: RequestInfo | URL, init?: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener(
                        'abort',
                        () => reject(init.signal?.reason),
                        { once: true },
                    );
                }),
        );
        const service = makeImageService({
            images: binding.images,
            fetch: fetch as typeof globalThis.fetch,
        });
        const result = expect(
            service.transformFeedImage({
                sourceUrl: 'https://images.example.test/icon.png',
                preset: 'small',
                accept: null,
            }),
        ).rejects.toMatchObject({ _tag: 'FeedImageUnavailable' });

        await vi.advanceTimersByTimeAsync(IMAGE_FETCH_TIMEOUT_MS - 1);
        expect(binding.images.input).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await result;
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
