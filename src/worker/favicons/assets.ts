import { Effect, Schema } from 'effect';

import type { D1 } from '../infrastructure/d1';
import { inspectNormalizedFavicon } from './darkness';
import { FaviconSourceError, prepareFaviconSource } from './source';

const FAVICON_SIZE = 32;
const MAX_FAVICON_ASSET_BYTES = 64 * 1024;
const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
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
        stage: Schema.Literals(['source', 'transform', 'output']),
        retryable: Schema.Boolean,
    },
) {}

export interface StoredFaviconAsset {
    readonly hash: string;
    readonly isDark: boolean | null;
}

export interface FaviconAssetRepository {
    readonly put: (
        hash: string,
        png: Uint8Array,
        createdAt: number,
    ) => Promise<void>;
    readonly find: (hash: string) => Promise<Uint8Array | null>;
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
    stage: 'source' | 'transform' | 'output',
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

export const makeD1FaviconAssetRepository = (
    d1: D1,
): FaviconAssetRepository => ({
    put: async (hash, png, createdAt) => {
        try {
            validateHash(hash);
            if (
                png.byteLength < PNG_SIGNATURE.byteLength ||
                png.byteLength > MAX_FAVICON_ASSET_BYTES ||
                !PNG_SIGNATURE.every((byte, index) => png[index] === byte) ||
                !Number.isSafeInteger(createdAt) ||
                createdAt < 0
            ) {
                throw new FaviconAssetStorageError();
            }
            await Effect.runPromise(
                d1.run({
                    sql: `INSERT INTO favicon_assets (hash, png, created_at)
                        VALUES (?, ?, ?)
                        ON CONFLICT(hash) DO NOTHING`,
                    bindings: [hash, arrayBuffer(png), createdAt],
                }),
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
                d1.first<{ readonly png: unknown }>({
                    sql: 'SELECT png FROM favicon_assets WHERE hash = ?',
                    bindings: [hash],
                }),
            );
            if (row === null) return null;
            const png = decodeBlob(row.png);
            if (
                png.byteLength === 0 ||
                png.byteLength > MAX_FAVICON_ASSET_BYTES ||
                png.byteLength < PNG_SIGNATURE.byteLength ||
                !PNG_SIGNATURE.every((byte, index) => png[index] === byte)
            ) {
                throw new FaviconAssetStorageError();
            }
            return png;
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
            const result = await Effect.runPromise(
                d1.run({
                    sql: `DELETE FROM favicon_assets
                        WHERE hash IN (
                            SELECT fa.hash
                            FROM favicon_assets fa
                            WHERE fa.created_at < ?
                              AND NOT EXISTS (
                                  SELECT 1 FROM feeds f
                                  WHERE f.favicon_asset_hash = fa.hash
                              )
                            ORDER BY fa.created_at ASC, fa.hash ASC
                            LIMIT ?
                        )`,
                    bindings: [olderThan, limit],
                }),
            );
            return result.meta.changes;
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

export const makeFaviconAssetStore = (
    dependencies: FaviconAssetStoreDependencies,
): FaviconAssetStore => ({
    persist: async (source) => {
        let prepared: Awaited<ReturnType<typeof prepareFaviconSource>>;
        try {
            prepared = await prepareFaviconSource(source);
        } catch (cause) {
            if (cause instanceof FaviconSourceError)
                throw candidateError('source');
            throw candidateError('source', true);
        }

        let normalized: Uint8Array;
        let inspection =
            prepared.kind === 'png' &&
            isExactSize(prepared.bytes, FAVICON_SIZE, FAVICON_SIZE)
                ? await inspectNormalizedFavicon(prepared.bytes)
                : { valid: false, isDark: null };
        if (inspection.valid) {
            normalized = prepared.bytes;
        } else {
            let output: ImageTransformationResult;
            try {
                const sourceBody = new Response(arrayBuffer(prepared.bytes))
                    .body;
                if (sourceBody === null) throw candidateError('source');
                output = await dependencies.images
                    .input(sourceBody)
                    .transform({
                        width: FAVICON_SIZE,
                        height: FAVICON_SIZE,
                        fit: 'cover',
                    })
                    .output({ format: 'image/png', anim: false });
            } catch (cause) {
                if (cause instanceof FaviconAssetCandidateError) throw cause;
                throw candidateError('transform', true);
            }
            normalized = await readBoundedPng(output.response());
            inspection = await inspectNormalizedFavicon(normalized);
            if (!inspection.valid) throw candidateError('output');
        }

        try {
            const digest = await crypto.subtle.digest(
                'SHA-256',
                arrayBuffer(normalized),
            );
            const hash = hex(digest);
            await dependencies.repository.put(
                hash,
                normalized,
                (dependencies.now ?? Date.now)(),
            );
            return { hash, isDark: inspection.isDark };
        } catch (cause) {
            if (cause instanceof FaviconAssetStorageError) throw cause;
            throw new FaviconAssetStorageError();
        }
    },
});

export const FAVICON_ASSET_CACHE_CONTROL = CACHE_CONTROL;
export const FAVICON_ASSET_MAX_BYTES = MAX_FAVICON_ASSET_BYTES;
