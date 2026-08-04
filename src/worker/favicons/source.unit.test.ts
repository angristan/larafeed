import { describe, expect, it } from 'vitest';

import { FaviconSourceError, prepareFaviconSource } from './source';

const png = Uint8Array.from(
    atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    ),
    (character) => character.charCodeAt(0),
);
const ico = (width: number, height: number, frame: Uint8Array): Uint8Array => {
    const bytes = new Uint8Array(22 + frame.byteLength);
    const view = new DataView(bytes.buffer);
    view.setUint16(2, 1, true);
    view.setUint16(4, 1, true);
    bytes[6] = width === 256 ? 0 : width;
    bytes[7] = height === 256 ? 0 : height;
    view.setUint16(10, 1, true);
    view.setUint16(12, 32, true);
    view.setUint32(14, frame.byteLength, true);
    view.setUint32(18, 22, true);
    bytes.set(frame, 22);
    return bytes;
};
const dib32 = (width: number, height: number): Uint8Array => {
    const xorStride = width * 4;
    const maskStride = Math.floor((width + 31) / 32) * 4;
    const bytes = new Uint8Array(40 + xorStride * height + maskStride * height);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 40, true);
    view.setInt32(4, width, true);
    view.setInt32(8, height * 2, true);
    view.setUint16(12, 1, true);
    view.setUint16(14, 32, true);
    view.setUint32(20, xorStride * height, true);
    for (let offset = 40; offset < 40 + xorStride * height; offset += 4) {
        bytes[offset] = 0x10;
        bytes[offset + 1] = 0x80;
        bytes[offset + 2] = 0xf0;
        bytes[offset + 3] = 0xff;
    }
    return bytes;
};

describe('favicon source preparation', () => {
    it('accepts SVGs with local paint references', async () => {
        const source =
            new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg">
            <defs><linearGradient id="paint"><stop /></linearGradient></defs>
            <path fill="url(#paint)" /><use href="#paint" />
        </svg>`);

        await expect(prepareFaviconSource(source)).resolves.toEqual({
            bytes: source,
            kind: 'svg',
        });
    });

    it.each([
        '<svg><script>alert(1)</script></svg>',
        '<svg><image href="https://private.example/image.png" /></svg>',
        '<!DOCTYPE svg><svg />',
        '<svg><style>@import "https://example.test/style.css"</style></svg>',
    ])('rejects active or externally-referencing SVG input', async (source) => {
        await expect(
            prepareFaviconSource(new TextEncoder().encode(source)),
        ).rejects.toBeInstanceOf(FaviconSourceError);
    });

    it('extracts an embedded PNG frame from ICO', async () => {
        const prepared = await prepareFaviconSource(ico(32, 32, png));

        expect(prepared.kind).toBe('png');
        expect(prepared.bytes).toEqual(png);
    });

    it('decodes a bounded legacy DIB frame from ICO', async () => {
        const prepared = await prepareFaviconSource(ico(32, 32, dib32(32, 32)));

        expect(prepared.kind).toBe('png');
        expect(Array.from(prepared.bytes.subarray(0, 8))).toEqual([
            137, 80, 78, 71, 13, 10, 26, 10,
        ]);
        expect(new DataView(prepared.bytes.buffer).getUint32(16)).toBe(32);
        expect(new DataView(prepared.bytes.buffer).getUint32(20)).toBe(32);
    });

    it('rejects malformed ICO offsets', async () => {
        const malformed = ico(32, 32, png);
        new DataView(malformed.buffer).setUint32(
            18,
            malformed.byteLength,
            true,
        );

        await expect(prepareFaviconSource(malformed)).rejects.toBeInstanceOf(
            FaviconSourceError,
        );
    });
});
