import { Effect, Schema } from 'effect';

import type { D1 } from '../infrastructure/d1';
import { spanNames, type TelemetryFailure, traceAsync } from '../observability';
import { inspectNormalizedFavicon } from './darkness';
import { FaviconSourceError, prepareFaviconSource } from './source';
import { sanitizeSvg } from './svg';

const FAVICON_SIZE = 32;
const MAX_FAVICON_ASSET_BYTES = 64 * 1024;
const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_CONTENT_TYPE = 'image/png';
const SVG_CONTENT_TYPE = 'image/svg+xml';
const ASSET_VERSION = 'v1';
const CACHE_CONTROL = 'public, max-age=31536000, immutable';
const HASH_PATTERN = /^[a-f0-9]{64}$/u;

export const FaviconAssetHash = Schema.String.check(
    Schema.isPattern(HASH_PATTERN),
);

export class FaviconAssetStorageError extends Schema.TaggedErrorClass<FaviconAssetStorageError>()(
    'FaviconAssetStorageError',
    {},
) {}

export class FaviconAssetCandidateError extends Schema.TaggedErrorClass<FaviconAssetCandidateError>()(
    'FaviconAssetCandidateError',
    {
        stage: Schema.Literals(['source', 'sanitize', 'transform', 'output']),
        retryable: Schema.Boolean,
    },
) {}

export type FaviconAssetContentType =
    | typeof PNG_CONTENT_TYPE
    | typeof SVG_CONTENT_TYPE;

export interface FaviconAssetBody {
    readonly bytes: Uint8Array;
    readonly contentType: FaviconAssetContentType;
}

export interface StoredFaviconAsset {
    readonly hash: string;
    readonly isDark: boolean | null;
}

export interface FaviconAssetRepository {
    readonly put: (
        hash: string,
        asset: FaviconAssetBody,
        createdAt: number,
    ) => Promise<void>;
    readonly find: (hash: string) => Promise<FaviconAssetBody | null>;
    readonly deleteOrphans: (
        olderThan: number,
        limit: number,
    ) => Promise<number>;
}

export interface FaviconAssetStore {
    readonly persist: (source: Uint8Array) => Promise<StoredFaviconAsset>;
}

export interface FaviconAssetStoreDependencies {
    readonly repository: FaviconAssetRepository;
    readonly images: ImagesBinding;
    readonly now?: () => number;
}

const arrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    return copy;
};

const candidateError = (
    stage: 'source' | 'sanitize' | 'transform' | 'output',
    retryable = false,
) => new FaviconAssetCandidateError({ stage, retryable });

const readBoundedPng = async (response: Response): Promise<Uint8Array> => {
    const mime = response.headers
        .get('content-type')
        ?.split(';', 1)[0]
        ?.trim()
        .toLocaleLowerCase();
    if (!response.ok || response.body === null || mime !== 'image/png') {
        const retryable = response.status === 429 || response.status >= 500;
        await response.body?.cancel();
        throw candidateError('output', retryable);
    }

    const length = response.headers.get('content-length');
    if (length !== null) {
        const normalized = length.trim();
        if (
            !/^\d+$/u.test(normalized) ||
            Number(normalized) > MAX_FAVICON_ASSET_BYTES
        ) {
            await response.body.cancel();
            throw candidateError('output');
        }
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_FAVICON_ASSET_BYTES) {
                await reader.cancel();
                throw candidateError('output');
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    if (total === 0) throw candidateError('output');

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    if (
        bytes.byteLength < PNG_SIGNATURE.byteLength ||
        !PNG_SIGNATURE.every((value, index) => bytes[index] === value)
    )
        throw candidateError('output');
    return bytes;
};

const hex = (bytes: ArrayBuffer): string =>
    Array.from(new Uint8Array(bytes), (byte) =>
        byte.toString(16).padStart(2, '0'),
    ).join('');
const contentHash = async (bytes: Uint8Array): Promise<string> =>
    hex(await crypto.subtle.digest('SHA-256', arrayBuffer(bytes)));

const validateHash = (hash: string): string => {
    if (!HASH_PATTERN.test(hash)) throw new FaviconAssetStorageError();
    return hash;
};

export const faviconAssetPath = (hash: string): string =>
    `/api/public/favicons/${ASSET_VERSION}/${validateHash(hash)}.png`;

export const feedFaviconUrl = (input: {
    readonly feedId: number;
    readonly upstreamUrl: string | null;
    readonly assetHash: string | null;
}): string | null => {
    if (input.assetHash !== null) return faviconAssetPath(input.assetHash);
    return input.upstreamUrl === null
        ? null
        : `/api/images/feeds/${input.feedId}/small`;
};

const decodeBlob = (value: unknown): Uint8Array => {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(
            value.buffer.slice(
                value.byteOffset,
                value.byteOffset + value.byteLength,
            ),
        );
    }
    if (
        Array.isArray(value) &&
        value.every(
            (byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255,
        )
    ) {
        return Uint8Array.from(value as number[]);
    }
    throw new FaviconAssetStorageError();
};

const validateAssetBody = async (
    asset: FaviconAssetBody,
): Promise<FaviconAssetBody> => {
    if (
        asset.bytes.byteLength === 0 ||
        asset.bytes.byteLength > MAX_FAVICON_ASSET_BYTES
    ) {
        throw new FaviconAssetStorageError();
    }
    if (asset.contentType === PNG_CONTENT_TYPE) {
        if (
            asset.bytes.byteLength < PNG_SIGNATURE.byteLength ||
            !PNG_SIGNATURE.every((byte, index) => asset.bytes[index] === byte)
        ) {
            throw new FaviconAssetStorageError();
        }
        return asset;
    }
    if (asset.contentType !== SVG_CONTENT_TYPE)
        throw new FaviconAssetStorageError();
    try {
        const sanitized = await sanitizeSvg(asset.bytes);
        if (
            sanitized.byteLength !== asset.bytes.byteLength ||
            !sanitized.every((byte, index) => byte === asset.bytes[index])
        )
            throw new FaviconAssetStorageError();
        return asset;
    } catch (cause) {
        if (cause instanceof FaviconAssetStorageError) throw cause;
        throw new FaviconAssetStorageError();
    }
};

export const makeD1FaviconAssetRepository = (
    d1: D1,
): FaviconAssetRepository => ({
    put: async (hash, asset, createdAt) => {
        try {
            validateHash(hash);
            await validateAssetBody(asset);
            if ((await contentHash(asset.bytes)) !== hash)
                throw new FaviconAssetStorageError();
            if (!Number.isSafeInteger(createdAt) || createdAt < 0)
                throw new FaviconAssetStorageError();
            await Effect.runPromise(
                d1.run(
                    asset.contentType === PNG_CONTENT_TYPE
                        ? {
                              sql: `INSERT INTO favicon_assets (
                                      hash, png, created_at
                                  ) VALUES (?, ?, ?)
                                  ON CONFLICT(hash) DO NOTHING`,
                              bindings: [
                                  hash,
                                  arrayBuffer(asset.bytes),
                                  createdAt,
                              ],
                          }
                        : {
                              sql: `INSERT INTO favicon_svg_assets (
                                      hash, svg, created_at
                                  ) VALUES (?, ?, ?)
                                  ON CONFLICT(hash) DO NOTHING`,
                              bindings: [
                                  hash,
                                  arrayBuffer(asset.bytes),
                                  createdAt,
                              ],
                          },
                ),
            );
        } catch (cause) {
            if (cause instanceof FaviconAssetStorageError) throw cause;
            throw new FaviconAssetStorageError();
        }
    },
    find: async (hash) => {
        try {
            validateHash(hash);
            const row = await Effect.runPromise(
                d1.first<{
                    readonly body: unknown;
                    readonly content_type: unknown;
                }>({
                    sql: `SELECT body, content_type FROM (
                            SELECT png AS body, 'image/png' AS content_type
                            FROM favicon_assets WHERE hash = ?
                            UNION ALL
                            SELECT svg AS body, 'image/svg+xml' AS content_type
                            FROM favicon_svg_assets WHERE hash = ?
                        ) LIMIT 1`,
                    bindings: [hash, hash],
                }),
            );
            if (row === null) return null;
            if (
                row.content_type !== PNG_CONTENT_TYPE &&
                row.content_type !== SVG_CONTENT_TYPE
            ) {
                throw new FaviconAssetStorageError();
            }
            const asset = await validateAssetBody({
                bytes: decodeBlob(row.body),
                contentType: row.content_type,
            });
            if ((await contentHash(asset.bytes)) !== hash)
                throw new FaviconAssetStorageError();
            return asset;
        } catch (cause) {
            if (cause instanceof FaviconAssetStorageError) throw cause;
            throw new FaviconAssetStorageError();
        }
    },
    deleteOrphans: async (olderThan, limit) => {
        try {
            if (
                !Number.isSafeInteger(olderThan) ||
                olderThan < 0 ||
                !Number.isSafeInteger(limit) ||
                limit < 1 ||
                limit > 100
            ) {
                throw new FaviconAssetStorageError();
            }
            const candidates = await Effect.runPromise(
                d1.all<{ readonly hash: unknown; readonly kind: unknown }>({
                    sql: `SELECT hash, kind FROM (
                            SELECT fa.hash, 'png' AS kind, fa.created_at
                            FROM favicon_assets fa
                            WHERE fa.created_at < ?
                              AND NOT EXISTS (
                                  SELECT 1 FROM feeds f
                                  WHERE f.favicon_asset_hash = fa.hash
                              )
                            UNION ALL
                            SELECT fa.hash, 'svg' AS kind, fa.created_at
                            FROM favicon_svg_assets fa
                            WHERE fa.created_at < ?
                              AND NOT EXISTS (
                                  SELECT 1 FROM feeds f
                                  WHERE f.favicon_asset_hash = fa.hash
                              )
                        )
                        ORDER BY created_at ASC, hash ASC, kind ASC
                        LIMIT ?`,
                    bindings: [olderThan, olderThan, limit],
                }),
            );
            const pngHashes: string[] = [];
            const svgHashes: string[] = [];
            for (const candidate of candidates.results) {
                if (typeof candidate.hash !== 'string')
                    throw new FaviconAssetStorageError();
                validateHash(candidate.hash);
                if (candidate.kind === 'png') pngHashes.push(candidate.hash);
                else if (candidate.kind === 'svg')
                    svgHashes.push(candidate.hash);
                else throw new FaviconAssetStorageError();
            }
            const statements = [
                ...(pngHashes.length === 0
                    ? []
                    : [
                          {
                              sql: `DELETE FROM favicon_assets
                                  WHERE hash IN (${pngHashes.map(() => '?').join(', ')})
                                    AND NOT EXISTS (
                                        SELECT 1 FROM feeds f
                                        WHERE f.favicon_asset_hash = favicon_assets.hash
                                    )`,
                              bindings: pngHashes,
                          },
                      ]),
                ...(svgHashes.length === 0
                    ? []
                    : [
                          {
                              sql: `DELETE FROM favicon_svg_assets
                                  WHERE hash IN (${svgHashes.map(() => '?').join(', ')})
                                    AND NOT EXISTS (
                                        SELECT 1 FROM feeds f
                                        WHERE f.favicon_asset_hash = favicon_svg_assets.hash
                                    )`,
                              bindings: svgHashes,
                          },
                      ]),
            ];
            if (statements.length === 0) return 0;
            const deleted = await Effect.runPromise(d1.batch(statements));
            return deleted.reduce(
                (total, result) => total + result.meta.changes,
                0,
            );
        } catch (cause) {
            if (cause instanceof FaviconAssetStorageError) throw cause;
            throw new FaviconAssetStorageError();
        }
    },
});

const isExactSize = (png: Uint8Array, width: number, height: number): boolean =>
    png.byteLength >= 24 &&
    new DataView(png.buffer, png.byteOffset, png.byteLength).getUint32(16) ===
        width &&
    new DataView(png.buffer, png.byteOffset, png.byteLength).getUint32(20) ===
        height;

const assetFailure = (cause: unknown): TelemetryFailure => {
    if (cause instanceof FaviconAssetCandidateError) {
        return {
            errorClass: cause._tag,
            stage: cause.stage,
            retryable: cause.retryable,
        };
    }
    if (cause instanceof FaviconAssetStorageError) {
        return {
            errorClass: cause._tag,
            stage: 'storage',
            retryable: true,
        };
    }
    return { errorClass: 'Unknown', stage: 'unknown', retryable: true };
};

export const makeFaviconAssetStore = (
    dependencies: FaviconAssetStoreDependencies,
): FaviconAssetStore => ({
    persist: (source) =>
        traceAsync(
            spanNames.faviconAssetPersist,
            { 'app.favicon.source_bytes': source.byteLength },
            async (span) => {
                let prepared: Awaited<ReturnType<typeof prepareFaviconSource>>;
                try {
                    prepared = await prepareFaviconSource(source);
                } catch (cause) {
                    if (cause instanceof FaviconSourceError)
                        throw candidateError('source');
                    throw candidateError('source', true);
                }
                span.setAttribute('app.favicon.source_kind', prepared.kind);

                let asset: FaviconAssetBody;
                let isDark: boolean | null;
                if (prepared.kind === 'svg') {
                    let sanitized: Uint8Array;
                    try {
                        sanitized = await sanitizeSvg(prepared.bytes);
                    } catch (cause) {
                        if (cause instanceof FaviconSourceError)
                            throw candidateError('sanitize');
                        throw candidateError('sanitize', true);
                    }
                    asset = {
                        bytes: sanitized,
                        contentType: SVG_CONTENT_TYPE,
                    };
                    isDark = null;
                    span.setAttribute('app.favicon.sanitized', true);
                    span.setAttribute('app.favicon.transformed', false);
                } else {
                    let normalized: Uint8Array;
                    let inspection =
                        prepared.kind === 'png' &&
                        isExactSize(prepared.bytes, FAVICON_SIZE, FAVICON_SIZE)
                            ? await inspectNormalizedFavicon(prepared.bytes)
                            : { valid: false, isDark: null };
                    if (inspection.valid) {
                        normalized = prepared.bytes;
                        span.setAttribute('app.favicon.transformed', false);
                    } else {
                        span.setAttribute('app.favicon.transformed', true);
                        let output: ImageTransformationResult;
                        try {
                            const sourceBody = new Response(
                                arrayBuffer(prepared.bytes),
                            ).body;
                            if (sourceBody === null)
                                throw candidateError('source');
                            output = await dependencies.images
                                .input(sourceBody)
                                .transform({
                                    width: FAVICON_SIZE,
                                    height: FAVICON_SIZE,
                                    fit: 'cover',
                                })
                                .output({ format: 'image/png', anim: false });
                        } catch (cause) {
                            if (cause instanceof FaviconAssetCandidateError)
                                throw cause;
                            throw candidateError('transform', true);
                        }
                        normalized = await readBoundedPng(output.response());
                        inspection = await inspectNormalizedFavicon(normalized);
                        if (!inspection.valid) throw candidateError('output');
                    }
                    asset = {
                        bytes: normalized,
                        contentType: PNG_CONTENT_TYPE,
                    };
                    isDark = inspection.isDark;
                }
                span.setAttribute(
                    'app.favicon.normalized_bytes',
                    asset.bytes.byteLength,
                );

                try {
                    const hash = await contentHash(asset.bytes);
                    await dependencies.repository.put(
                        hash,
                        asset,
                        (dependencies.now ?? Date.now)(),
                    );
                    return { hash, isDark };
                } catch (cause) {
                    if (cause instanceof FaviconAssetStorageError) throw cause;
                    throw new FaviconAssetStorageError();
                }
            },
            assetFailure,
        ),
});

export const FAVICON_ASSET_CACHE_CONTROL = CACHE_CONTROL;
export const FAVICON_ASSET_MAX_BYTES = MAX_FAVICON_ASSET_BYTES;
