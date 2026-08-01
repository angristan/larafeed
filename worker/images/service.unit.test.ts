import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    IMAGE_FETCH_TIMEOUT_MS,
    MAX_IMAGE_RESPONSE_BYTES,
    makeImageService,
} from './service';

const bytes = (size = 8): ArrayBuffer => new Uint8Array(size).buffer;
const imageResponse = (size = 8, contentType = 'image/png') =>
    new Response(bytes(size), { headers: { 'content-type': contentType } });

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
        expect(fetch).toHaveBeenCalledWith(
            new URL('https://images.example.test/icon.png'),
            expect.objectContaining({ redirect: 'manual' }),
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
