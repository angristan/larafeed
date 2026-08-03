import { validateFeedUrl } from '../feeds/policy';

export const IMAGE_FETCH_TIMEOUT_MS = 5_000;
export const MAX_IMAGE_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_REDIRECTS = 3;

export type FeedImagePreset = 'small' | 'medium';

type AutoImageFormat = 'image/avif' | 'image/webp' | 'image/png';

interface FixedImagePreset {
    readonly transform: Readonly<ImageTransform>;
    readonly quality: number;
}

export const IMAGE_PRESETS: Readonly<
    Record<FeedImagePreset, FixedImagePreset>
> = {
    small: {
        transform: { width: 32, height: 32, fit: 'cover' },
        quality: 80,
    },
    medium: {
        transform: { width: 64, height: 64, fit: 'cover' },
        quality: 80,
    },
};
export const ARTICLE_IMAGE_PRESET: FixedImagePreset = {
    transform: { width: 1_600, fit: 'scale-down' },
    quality: 85,
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_IMAGE_MIME = /^image\/[a-z0-9.+-]+$/u;
const SVG_MIME = 'image/svg+xml';
const IMAGE_ACCEPT =
    'image/avif,image/webp,image/png,image/jpeg,image/gif,image/x-icon,image/vnd.microsoft.icon;q=0.9';

export interface ImageServiceDependencies {
    readonly images: ImagesBinding;
    readonly fetch?: typeof globalThis.fetch;
}

export interface TransformFeedImageInput {
    readonly sourceUrl: string;
    readonly preset: FeedImagePreset;
    readonly accept: string | null;
}

export interface TransformArticleImageInput {
    readonly sourceUrl: string;
    readonly accept: string | null;
}

export class FeedImageUnavailable extends Error {
    readonly _tag = 'FeedImageUnavailable';
}

const unavailable = (): FeedImageUnavailable => new FeedImageUnavailable();

const autoFormat = (accept: string | null): AutoImageFormat => {
    const normalized = accept?.toLowerCase() ?? '';
    if (normalized.includes('image/avif')) return 'image/avif';
    if (normalized.includes('image/webp')) return 'image/webp';
    return 'image/png';
};

const imageMime = (response: Response): string | null => {
    const value = response.headers.get('content-type');
    if (value === null) return null;
    const mime = value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
    return ALLOWED_IMAGE_MIME.test(mime) && mime !== SVG_MIME ? mime : null;
};

const boundedImageBody = async (response: Response): Promise<Uint8Array> => {
    const contentLength = response.headers.get('content-length');
    if (contentLength !== null) {
        const normalized = contentLength.trim();
        if (!/^\d+$/u.test(normalized)) {
            await response.body?.cancel();
            throw unavailable();
        }
        const length = Number(normalized);
        if (
            !Number.isSafeInteger(length) ||
            length > MAX_IMAGE_RESPONSE_BYTES
        ) {
            await response.body?.cancel();
            throw unavailable();
        }
    }

    if (response.body === null) throw unavailable();

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_IMAGE_RESPONSE_BYTES) {
                await reader.cancel();
                throw unavailable();
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    if (total === 0) throw unavailable();
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
};

export const fetchImageBytes = async (
    sourceUrl: string,
    fetchImplementation: typeof globalThis.fetch,
): Promise<Uint8Array> => {
    let currentUrl: URL;
    try {
        currentUrl = validateFeedUrl(sourceUrl);
    } catch {
        throw unavailable();
    }

    const controller = new AbortController();
    const timeout = setTimeout(
        () =>
            controller.abort(
                new DOMException('Image fetch timed out', 'TimeoutError'),
            ),
        IMAGE_FETCH_TIMEOUT_MS,
    );
    let redirects = 0;

    try {
        while (true) {
            const response = await fetchImplementation(currentUrl, {
                method: 'GET',
                headers: {
                    accept: IMAGE_ACCEPT,
                    'user-agent':
                        'Larafeed/1.0 (+https://larafeed.stanislas.cloud)',
                },
                redirect: 'manual',
                signal: controller.signal,
            });

            if (REDIRECT_STATUSES.has(response.status)) {
                if (redirects === MAX_IMAGE_REDIRECTS) {
                    await response.body?.cancel();
                    throw unavailable();
                }
                const location = response.headers.get('location');
                await response.body?.cancel();
                if (location === null) throw unavailable();
                try {
                    currentUrl = validateFeedUrl(new URL(location, currentUrl));
                } catch {
                    throw unavailable();
                }
                redirects += 1;
                continue;
            }

            if (response.status < 200 || response.status >= 300) {
                await response.body?.cancel();
                throw unavailable();
            }
            if (imageMime(response) === null) {
                await response.body?.cancel();
                throw unavailable();
            }
            return await boundedImageBody(response);
        }
    } catch (cause) {
        if (cause instanceof FeedImageUnavailable) throw cause;
        throw unavailable();
    } finally {
        clearTimeout(timeout);
    }
};

const transformImage = async (
    dependencies: ImageServiceDependencies,
    input: TransformArticleImageInput,
    preset: FixedImagePreset,
): Promise<Response> => {
    try {
        const source = await fetchImageBytes(
            input.sourceUrl,
            dependencies.fetch ?? globalThis.fetch.bind(globalThis),
        );
        const sourceBuffer = new ArrayBuffer(source.byteLength);
        new Uint8Array(sourceBuffer).set(source);
        const sourceStream = new Response(sourceBuffer).body;
        if (sourceStream === null) throw unavailable();

        const output = await dependencies.images
            .input(sourceStream)
            .transform(preset.transform)
            .output({
                format: autoFormat(input.accept),
                quality: preset.quality,
                anim: false,
            });
        const response = output.response();
        if (response.body === null) throw unavailable();
        return response;
    } catch (cause) {
        throw cause instanceof FeedImageUnavailable ? cause : unavailable();
    }
};

export const makeImageService = (dependencies: ImageServiceDependencies) => ({
    transformFeedImage: (input: TransformFeedImageInput): Promise<Response> =>
        transformImage(dependencies, input, IMAGE_PRESETS[input.preset]),
    transformArticleImage: (
        input: TransformArticleImageInput,
    ): Promise<Response> =>
        transformImage(dependencies, input, ARTICLE_IMAGE_PRESET),
});

export type ImageService = ReturnType<typeof makeImageService>;
