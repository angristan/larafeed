import { Effect } from 'effect';
import type { Hono } from 'hono';
import { getCookie } from 'hono/cookie';

import { type AuthRuntime, defaultAuthRuntimeFactory } from '../auth/routes';
import type { AuthenticatedSession } from '../auth/service';
import { makeD1 } from '../infrastructure/d1';
import { findArticleImageSource, MAX_ARTICLE_IMAGES } from './article';
import {
    type ArticleImageSource,
    type FeedImageSource,
    type ImageRepository,
    makeImageRepository,
} from './repository';
import {
    type FeedImagePreset,
    type ImageService,
    makeImageService,
} from './service';

const PRIVATE_IMAGE_HEADERS = {
    'cache-control': 'private, no-store',
    'content-security-policy': "default-src 'none'; sandbox",
    'x-content-type-options': 'nosniff',
} as const;
const ARTICLE_IMAGE_CACHE_CONTROL = 'private, max-age=86400';

// Fixed transparent PNG. Upstream failures never disclose source details.
const PLACEHOLDER_BYTES = Uint8Array.from(
    atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    ),
    (character) => character.charCodeAt(0),
);

interface ImageBindingEnv {
    readonly IMAGES: ImagesBinding;
}

export interface ImageRuntime {
    readonly auth: AuthRuntime;
    readonly repository: ImageRepository;
    readonly service: ImageService;
    readonly rateLimit: (key: string) => Promise<{ readonly success: boolean }>;
}

export type ImageRuntimeFactory = (
    env: Env,
) => Effect.Effect<ImageRuntime, unknown>;

export interface ImageRouteDependencies {
    readonly runtimeFactory?: ImageRuntimeFactory;
}

export const imagesEnabled = (env: Pick<Env, 'IMAGES_ENABLED'>): boolean =>
    env.IMAGES_ENABLED === 'true';

export const imageRateLimitKey = (userId: number): string => `image:${userId}`;

export const defaultImageRuntimeFactory: ImageRuntimeFactory = (env) =>
    defaultAuthRuntimeFactory(env).pipe(
        Effect.flatMap((auth) =>
            Effect.try({
                try: () => {
                    if (!imagesEnabled(env)) {
                        throw new Error('Images are disabled');
                    }
                    const images = (env as Env & ImageBindingEnv).IMAGES;
                    if (images === undefined) {
                        throw new Error('IMAGES binding is unavailable');
                    }
                    return {
                        auth,
                        repository: makeImageRepository(makeD1(env.DB)),
                        service: makeImageService({
                            images,
                            cache: (
                                caches as CacheStorage & {
                                    readonly default: Cache;
                                }
                            ).default,
                            cacheOrigin: auth.config.origin,
                        }),
                        rateLimit: (key: string) =>
                            env.AUTH_RATE_LIMITER.limit({ key }),
                    };
                },
                catch: (cause) => cause,
            }),
        ),
    );

const placeholderResponse = (): Response =>
    new Response(PLACEHOLDER_BYTES, {
        status: 200,
        headers: {
            ...PRIVATE_IMAGE_HEADERS,
            'content-length': String(PLACEHOLDER_BYTES.byteLength),
            'content-type': 'image/png',
        },
    });

const jsonError = (status: number, code: string, message: string): Response =>
    new Response(JSON.stringify({ error: { code, message } }), {
        status,
        headers: {
            ...PRIVATE_IMAGE_HEADERS,
            'content-type': 'application/json; charset=UTF-8',
        },
    });

const taggedError = (error: unknown): string | undefined => {
    if (typeof error !== 'object' || error === null) return undefined;
    const tag = Reflect.get(error, '_tag');
    return typeof tag === 'string' ? tag : undefined;
};

const runtimeErrorResponse = (error: unknown): Response => {
    if (taggedError(error) === 'Unauthenticated') {
        return jsonError(401, 'unauthenticated', 'Authentication required');
    }
    return jsonError(503, 'service_unavailable', 'Service unavailable');
};

const parsePositiveId = (value: string, maximum = Number.MAX_SAFE_INTEGER) => {
    if (!/^[1-9]\d*$/u.test(value)) return null;
    const id = Number(value);
    return Number.isSafeInteger(id) && id <= maximum ? id : null;
};
const parseFeedId = (value: string): number | null => parsePositiveId(value);

const parsePreset = (value: string): FeedImagePreset | null =>
    value === 'small' || value === 'medium' ? value : null;

const transformedResponse = (
    source: Response,
    cacheControl: string = PRIVATE_IMAGE_HEADERS['cache-control'],
): Response => {
    const contentType = source.headers.get('content-type');
    if (
        source.body === null ||
        contentType === null ||
        !/^image\/(?:avif|webp|png)(?:;|$)/iu.test(contentType)
    ) {
        return placeholderResponse();
    }
    return new Response(source.body, {
        status: 200,
        headers: {
            ...PRIVATE_IMAGE_HEADERS,
            'cache-control': cacheControl,
            'content-type': contentType,
            vary: 'Accept',
        },
    });
};

export const registerImageRoutes = (
    app: Hono<{ Bindings: Env }>,
    dependencies: ImageRouteDependencies = {},
): Hono<{ Bindings: Env }> => {
    const runtimeFactory =
        dependencies.runtimeFactory ?? defaultImageRuntimeFactory;

    app.get('/api/images/feeds/:feedId/:preset', async (context) => {
        const feedId = parseFeedId(context.req.param('feedId'));
        const preset = parsePreset(context.req.param('preset'));
        if (
            feedId === null ||
            preset === null ||
            new URL(context.req.url).search !== ''
        ) {
            return jsonError(404, 'not_found', 'Not found');
        }

        let runtime: ImageRuntime;
        try {
            runtime = await Effect.runPromise(runtimeFactory(context.env), {
                signal: context.req.raw.signal,
            });
        } catch (error) {
            return runtimeErrorResponse(error);
        }

        let session: AuthenticatedSession;
        try {
            session = await Effect.runPromise(
                runtime.auth.service.authenticateSession(
                    getCookie(context, runtime.auth.config.sessionCookie.name),
                ),
                { signal: context.req.raw.signal },
            );
        } catch (error) {
            return runtimeErrorResponse(error);
        }

        let rateLimit: { readonly success: boolean };
        try {
            rateLimit = await runtime.rateLimit(
                imageRateLimitKey(session.user.id),
            );
        } catch {
            return jsonError(503, 'service_unavailable', 'Service unavailable');
        }
        if (!rateLimit.success) {
            return jsonError(429, 'rate_limited', 'Too many requests');
        }

        let source: FeedImageSource | null;
        try {
            source = await Effect.runPromise(
                runtime.repository.findOwnedFeedSource(session.user.id, feedId),
                { signal: context.req.raw.signal },
            );
        } catch (error) {
            return runtimeErrorResponse(error);
        }
        if (source === null) {
            return jsonError(404, 'not_found', 'Not found');
        }
        if (source.faviconUrl === null) return placeholderResponse();

        try {
            return transformedResponse(
                await runtime.service.transformFeedImage({
                    sourceUrl: source.faviconUrl,
                    preset,
                    accept: context.req.header('Accept') ?? null,
                }),
            );
        } catch {
            return placeholderResponse();
        }
    });

    app.get('/api/images/entries/:entryId/:imageIndex', async (context) => {
        const entryId = parsePositiveId(context.req.param('entryId'));
        const imageIndex = parsePositiveId(
            context.req.param('imageIndex'),
            MAX_ARTICLE_IMAGES,
        );
        if (
            entryId === null ||
            imageIndex === null ||
            new URL(context.req.url).search !== ''
        ) {
            return jsonError(404, 'not_found', 'Not found');
        }

        let runtime: ImageRuntime;
        try {
            runtime = await Effect.runPromise(runtimeFactory(context.env), {
                signal: context.req.raw.signal,
            });
        } catch (error) {
            return runtimeErrorResponse(error);
        }

        let session: AuthenticatedSession;
        try {
            session = await Effect.runPromise(
                runtime.auth.service.authenticateSession(
                    getCookie(context, runtime.auth.config.sessionCookie.name),
                ),
                { signal: context.req.raw.signal },
            );
        } catch (error) {
            return runtimeErrorResponse(error);
        }

        let rateLimit: { readonly success: boolean };
        try {
            rateLimit = await runtime.rateLimit(
                imageRateLimitKey(session.user.id),
            );
        } catch {
            return jsonError(503, 'service_unavailable', 'Service unavailable');
        }
        if (!rateLimit.success) {
            return jsonError(429, 'rate_limited', 'Too many requests');
        }

        let article: ArticleImageSource | null;
        try {
            article = await Effect.runPromise(
                runtime.repository.findOwnedArticleSource(
                    session.user.id,
                    entryId,
                ),
                { signal: context.req.raw.signal },
            );
        } catch (error) {
            return runtimeErrorResponse(error);
        }
        if (article === null) {
            return jsonError(404, 'not_found', 'Not found');
        }

        try {
            const sourceUrl = await findArticleImageSource(
                article.contentHtml,
                article.entryUrl,
                imageIndex,
            );
            if (sourceUrl === null) return placeholderResponse();

            return transformedResponse(
                await runtime.service.transformArticleImage({
                    sourceUrl,
                    accept: context.req.header('Accept') ?? null,
                }),
                ARTICLE_IMAGE_CACHE_CONTROL,
            );
        } catch {
            return placeholderResponse();
        }
    });

    return app;
};
