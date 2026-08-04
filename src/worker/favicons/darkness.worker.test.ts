import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';

import {
    faviconDarknessEnabled,
    makeFaviconDarknessAnalyzer,
} from './darkness';

const arrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    return copy;
};

const concatenate = (parts: readonly Uint8Array[]): Uint8Array => {
    const bytes = new Uint8Array(
        parts.reduce((total, part) => total + part.byteLength, 0),
    );
    let offset = 0;
    for (const part of parts) {
        bytes.set(part, offset);
        offset += part.byteLength;
    }
    return bytes;
};

const crc32 = (bytes: Uint8Array): number => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1)
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const bytes = new Uint8Array(12 + data.byteLength);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, data.byteLength);
    bytes.set(new TextEncoder().encode(type), 4);
    bytes.set(data, 8);
    view.setUint32(
        8 + data.byteLength,
        crc32(bytes.subarray(4, 8 + data.byteLength)),
    );
    return bytes;
};

const solidPng = async (
    red: number,
    green: number,
    blue: number,
    alpha: number,
): Promise<Uint8Array> => {
    const size = 10;
    const raw = new Uint8Array(size * (1 + size * 4));
    for (let row = 0; row < size; row += 1) {
        const start = row * (1 + size * 4);
        raw[start] = 0;
        for (let column = 0; column < size; column += 1) {
            const offset = start + 1 + column * 4;
            raw.set([red, green, blue, alpha], offset);
        }
    }
    const source = new Response(arrayBuffer(raw)).body;
    if (source === null) throw new Error('Missing test stream');
    const compressed = new Uint8Array(
        await new Response(
            source.pipeThrough(new CompressionStream('deflate')),
        ).arrayBuffer(),
    );
    const header = new Uint8Array(13);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, size);
    headerView.setUint32(4, size);
    header[8] = 8;
    header[9] = 6;
    return concatenate([
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header),
        chunk('IDAT', compressed),
        chunk('IEND', new Uint8Array()),
    ]);
};

const binding = (outputBytes: Uint8Array) => {
    const output = vi.fn().mockResolvedValue({
        response: () =>
            new Response(arrayBuffer(outputBytes), {
                headers: {
                    'content-length': String(outputBytes.byteLength),
                    'content-type': 'image/png',
                },
            }),
    });
    const transform = vi.fn(() => ({ output }));
    const input = vi.fn(() => ({ transform }));
    return {
        images: { input } as unknown as ImagesBinding,
        input,
        transform,
        output,
    };
};

describe('favicon darkness analysis', () => {
    it('uses the exact existing rollout gate', () => {
        expect(faviconDarknessEnabled({ IMAGES_ENABLED: 'true' })).toBe(true);
        for (const value of ['false', 'TRUE', '1', '']) {
            expect(faviconDarknessEnabled({ IMAGES_ENABLED: value })).toBe(
                false,
            );
        }
    });

    it.each([
        { name: 'dark', color: [0, 0, 0, 255] as const, expected: true },
        {
            name: 'light',
            color: [255, 255, 255, 255] as const,
            expected: false,
        },
        {
            name: 'transparent',
            color: [0, 0, 0, 0] as const,
            expected: null,
        },
    ])('classifies $name Images output', async ({ color, expected }) => {
        const mock = binding(
            await solidPng(color[0], color[1], color[2], color[3]),
        );
        const analyze = makeFaviconDarknessAnalyzer(mock.images);

        await expect(analyze(new Uint8Array([1, 2, 3]))).resolves.toBe(
            expected,
        );
        expect(mock.transform).toHaveBeenCalledWith({
            width: 10,
            height: 10,
            fit: 'squeeze',
        });
        expect(mock.output).toHaveBeenCalledWith({
            format: 'image/png',
            anim: false,
        });
    });

    it('classifies pixels through the local Images binding', async () => {
        const analyze = makeFaviconDarknessAnalyzer(env.IMAGES);

        await expect(analyze(await solidPng(0, 0, 0, 255))).resolves.toBe(true);
        await expect(analyze(await solidPng(255, 255, 255, 255))).resolves.toBe(
            false,
        );
        await expect(analyze(await solidPng(0, 0, 0, 0))).resolves.toBeNull();
    });

    it('fails closed for invalid transform output', async () => {
        const mock = binding(new Uint8Array([1, 2, 3]));
        const analyze = makeFaviconDarknessAnalyzer(mock.images);

        await expect(analyze(new Uint8Array([1]))).resolves.toBeNull();
    });

    it('fails closed when a transformed PNG checksum is corrupt', async () => {
        const corrupted = (await solidPng(0, 0, 0, 255)).slice();
        corrupted[29] = (corrupted[29] ?? 0) ^ 0xff;
        const mock = binding(corrupted);
        const analyze = makeFaviconDarknessAnalyzer(mock.images);

        await expect(analyze(new Uint8Array([1]))).resolves.toBeNull();
    });

    it('rejects oversized source bytes before transformation', async () => {
        const mock = binding(await solidPng(0, 0, 0, 255));
        const analyze = makeFaviconDarknessAnalyzer(mock.images);

        await expect(
            analyze(new Uint8Array(2 * 1024 * 1024 + 1)),
        ).resolves.toBeNull();
        expect(mock.input).not.toHaveBeenCalled();
    });
});
