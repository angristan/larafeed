const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_SVG_BYTES = 256 * 1024;
const MAX_ICO_FRAMES = 64;
const MAX_ICO_DIMENSION = 256;
const MAX_PNG_BYTES = 64 * 1024;

export type FaviconSourceKind = 'png' | 'jpeg' | 'gif' | 'webp' | 'svg' | 'ico';

export class FaviconSourceError extends Error {
    constructor(readonly reason: 'unsupported' | 'invalid') {
        super(`Favicon source is ${reason}`);
        this.name = 'FaviconSourceError';
    }
}

export interface PreparedFaviconSource {
    readonly bytes: Uint8Array;
    readonly kind: Exclude<FaviconSourceKind, 'ico'>;
}

const startsWith = (bytes: Uint8Array, expected: ArrayLike<number>): boolean =>
    Array.from(expected).every((value, index) => bytes[index] === value);
const ascii = (bytes: Uint8Array): string =>
    new TextDecoder('ascii').decode(bytes);

const readStream = async (
    stream: ReadableStream<Uint8Array>,
    maximum: number,
): Promise<Uint8Array> => {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maximum) {
                await reader.cancel();
                throw new FaviconSourceError('invalid');
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
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
const pngChunk = (type: string, data: Uint8Array): Uint8Array => {
    const chunk = new Uint8Array(12 + data.byteLength);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, data.byteLength);
    chunk.set(new TextEncoder().encode(type), 4);
    chunk.set(data, 8);
    view.setUint32(
        8 + data.byteLength,
        crc32(chunk.subarray(4, 8 + data.byteLength)),
    );
    return chunk;
};
const concatenate = (chunks: readonly Uint8Array[]): Uint8Array => {
    const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
};
const encodeRgbaPng = async (
    width: number,
    height: number,
    rgba: Uint8Array,
): Promise<Uint8Array> => {
    if (
        width < 1 ||
        width > MAX_ICO_DIMENSION ||
        height < 1 ||
        height > MAX_ICO_DIMENSION ||
        rgba.byteLength !== width * height * 4
    )
        throw new FaviconSourceError('invalid');
    const scanlines = new Uint8Array(height * (1 + width * 4));
    for (let row = 0; row < height; row += 1) {
        const target = row * (1 + width * 4);
        scanlines[target] = 0;
        scanlines.set(
            rgba.subarray(row * width * 4, (row + 1) * width * 4),
            target + 1,
        );
    }
    const stream = new Response(scanlines).body;
    if (stream === null) throw new FaviconSourceError('invalid');
    const compressed = await readStream(
        stream.pipeThrough(new CompressionStream('deflate')),
        MAX_PNG_BYTES,
    );
    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    header[8] = 8;
    header[9] = 6;
    return concatenate([
        PNG_SIGNATURE,
        pngChunk('IHDR', header),
        pngChunk('IDAT', compressed),
        pngChunk('IEND', new Uint8Array()),
    ]);
};

interface IcoFrame {
    readonly width: number;
    readonly height: number;
    readonly bytes: Uint8Array;
    readonly png: boolean;
}
const icoFrames = (source: Uint8Array): readonly IcoFrame[] => {
    if (source.byteLength < 22 || !startsWith(source, [0, 0, 1, 0]))
        throw new FaviconSourceError('invalid');
    const view = new DataView(
        source.buffer,
        source.byteOffset,
        source.byteLength,
    );
    const count = view.getUint16(4, true);
    if (
        count < 1 ||
        count > MAX_ICO_FRAMES ||
        6 + count * 16 > source.byteLength
    )
        throw new FaviconSourceError('invalid');
    const frames: IcoFrame[] = [];
    for (let index = 0; index < count; index += 1) {
        const entry = 6 + index * 16;
        const width = source[entry] === 0 ? 256 : (source[entry] ?? 0);
        const height = source[entry + 1] === 0 ? 256 : (source[entry + 1] ?? 0);
        const length = view.getUint32(entry + 8, true);
        const offset = view.getUint32(entry + 12, true);
        if (
            width < 1 ||
            height < 1 ||
            length < 8 ||
            offset < 6 + count * 16 ||
            offset + length > source.byteLength
        )
            continue;
        const bytes = source.slice(offset, offset + length);
        frames.push({
            width,
            height,
            bytes,
            png: startsWith(bytes, PNG_SIGNATURE),
        });
    }
    if (frames.length === 0) throw new FaviconSourceError('invalid');
    return frames;
};
const frameScore = (frame: IcoFrame): number => {
    const square = frame.width === frame.height ? 1_000 : 0;
    const size =
        frame.width === 32
            ? 500
            : frame.width > 32
              ? Math.max(0, 400 - (frame.width - 32))
              : Math.max(0, 300 - (32 - frame.width) * 2);
    return square + size + (frame.png ? 20 : 0);
};
const channelFromMask = (value: number, mask: number): number => {
    if (mask === 0) return 0;
    let shift = 0;
    while (((mask >>> shift) & 1) === 0 && shift < 32) shift += 1;
    const normalized = mask >>> shift;
    return Math.round((((value & mask) >>> shift) * 255) / normalized);
};

const decodeDib = async (frame: IcoFrame): Promise<Uint8Array> => {
    const bytes = frame.bytes;
    if (bytes.byteLength < 40) throw new FaviconSourceError('invalid');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const headerSize = view.getUint32(0, true);
    if (headerSize < 40 || headerSize > 124 || headerSize > bytes.byteLength)
        throw new FaviconSourceError('unsupported');
    const storedHeight = view.getInt32(8, true);
    if (
        Math.abs(view.getInt32(4, true)) !== frame.width ||
        Math.abs(storedHeight) < frame.height ||
        Math.abs(storedHeight) > frame.height * 2 ||
        view.getUint16(12, true) !== 1
    )
        throw new FaviconSourceError('invalid');
    const bitsPerPixel = view.getUint16(14, true);
    const compression = view.getUint32(16, true);
    if (
        ![1, 4, 8, 24, 32].includes(bitsPerPixel) ||
        ![0, 3].includes(compression) ||
        (compression === 3 && bitsPerPixel !== 32)
    )
        throw new FaviconSourceError('unsupported');

    let redMask = 0x00ff0000;
    let greenMask = 0x0000ff00;
    let blueMask = 0x000000ff;
    let alphaMask = bitsPerPixel === 32 ? 0xff000000 : 0;
    let paletteOffset = headerSize;
    if (compression === 3) {
        if (headerSize >= 56) {
            redMask = view.getUint32(40, true);
            greenMask = view.getUint32(44, true);
            blueMask = view.getUint32(48, true);
            alphaMask = view.getUint32(52, true);
        } else {
            if (bytes.byteLength < 52) throw new FaviconSourceError('invalid');
            redMask = view.getUint32(40, true);
            greenMask = view.getUint32(44, true);
            blueMask = view.getUint32(48, true);
            alphaMask = 0;
            paletteOffset = 52;
        }
    }
    const colorsUsed = view.getUint32(32, true);
    const paletteEntries =
        bitsPerPixel <= 8
            ? colorsUsed === 0
                ? 1 << bitsPerPixel
                : Math.min(colorsUsed, 1 << bitsPerPixel)
            : 0;
    const pixelOffset = paletteOffset + paletteEntries * 4;
    const xorStride = Math.floor((frame.width * bitsPerPixel + 31) / 32) * 4;
    const maskStride = Math.floor((frame.width + 31) / 32) * 4;
    const xorLength = xorStride * frame.height;
    const maskOffset = pixelOffset + xorLength;
    if (pixelOffset < headerSize || maskOffset > bytes.byteLength)
        throw new FaviconSourceError('invalid');
    const palette = Array.from({ length: paletteEntries }, (_, index) => {
        const offset = paletteOffset + index * 4;
        return [
            bytes[offset + 2] ?? 0,
            bytes[offset + 1] ?? 0,
            bytes[offset] ?? 0,
            255,
        ] as const;
    });
    const rgba = new Uint8Array(frame.width * frame.height * 4);
    let sawNonzeroAlpha = false;
    const topDown = storedHeight < 0;
    for (let y = 0; y < frame.height; y += 1) {
        const sourceY = topDown ? y : frame.height - 1 - y;
        const row = pixelOffset + sourceY * xorStride;
        for (let x = 0; x < frame.width; x += 1) {
            let red = 0;
            let green = 0;
            let blue = 0;
            let alpha = 255;
            if (bitsPerPixel === 32) {
                const value = view.getUint32(row + x * 4, true);
                red = channelFromMask(value, redMask);
                green = channelFromMask(value, greenMask);
                blue = channelFromMask(value, blueMask);
                alpha = channelFromMask(value, alphaMask);
                sawNonzeroAlpha ||= alpha > 0;
            } else if (bitsPerPixel === 24) {
                blue = bytes[row + x * 3] ?? 0;
                green = bytes[row + x * 3 + 1] ?? 0;
                red = bytes[row + x * 3 + 2] ?? 0;
            } else {
                const byte =
                    bytes[row + Math.floor((x * bitsPerPixel) / 8)] ?? 0;
                const index =
                    bitsPerPixel === 8
                        ? byte
                        : bitsPerPixel === 4
                          ? (byte >>> (x % 2 === 0 ? 4 : 0)) & 0x0f
                          : (byte >>> (7 - (x % 8))) & 1;
                [red, green, blue, alpha] = palette[index] ?? [0, 0, 0, 255];
            }
            const target = (y * frame.width + x) * 4;
            rgba.set([red, green, blue, alpha], target);
        }
    }
    const hasMask = maskOffset + maskStride * frame.height <= bytes.byteLength;
    for (let y = 0; y < frame.height; y += 1) {
        const sourceY = topDown ? y : frame.height - 1 - y;
        for (let x = 0; x < frame.width; x += 1) {
            const target = (y * frame.width + x) * 4 + 3;
            const transparent =
                hasMask &&
                (((bytes[
                    maskOffset + sourceY * maskStride + Math.floor(x / 8)
                ] ?? 0) >>>
                    (7 - (x % 8))) &
                    1) ===
                    1;
            if (transparent) rgba[target] = 0;
            else if (bitsPerPixel !== 32 || !sawNonzeroAlpha)
                rgba[target] = 255;
        }
    }
    return encodeRgbaPng(frame.width, frame.height, rgba);
};
const prepareIco = async (source: Uint8Array): Promise<Uint8Array> => {
    const frames = [...icoFrames(source)].sort(
        (left, right) => frameScore(right) - frameScore(left),
    );
    let unsupported = false;
    for (const frame of frames) {
        try {
            return frame.png ? frame.bytes : await decodeDib(frame);
        } catch (cause) {
            unsupported ||=
                cause instanceof FaviconSourceError &&
                cause.reason === 'unsupported';
        }
    }
    throw new FaviconSourceError(unsupported ? 'unsupported' : 'invalid');
};

const validateSvg = (source: Uint8Array): void => {
    if (source.byteLength === 0 || source.byteLength > MAX_SVG_BYTES)
        throw new FaviconSourceError('invalid');
    let text: string;
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(source);
    } catch {
        throw new FaviconSourceError('invalid');
    }
    if (
        !/<svg\b/iu.test(text) ||
        /<!\s*(?:doctype|entity)\b/iu.test(text) ||
        /<\s*(?:script|foreignObject|iframe|object|embed|a)\b/iu.test(text) ||
        /\son[a-z][a-z0-9:._-]*\s*=/iu.test(text) ||
        /(?:javascript|vbscript)\s*:/iu.test(text) ||
        /@import\b/iu.test(text)
    )
        throw new FaviconSourceError('unsupported');
    for (const match of text.matchAll(
        /(?:href|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)')/giu,
    )) {
        const value = (match[1] ?? match[2] ?? '').trim();
        if (value !== '' && !value.startsWith('#'))
            throw new FaviconSourceError('unsupported');
    }
    for (const match of text.matchAll(/url\(\s*([^)]+?)\s*\)/giu)) {
        const value = (match[1] ?? '').trim().replace(/^['"]|['"]$/gu, '');
        if (!value.startsWith('#')) throw new FaviconSourceError('unsupported');
    }
};

export const faviconSourceKind = (
    source: Uint8Array,
): FaviconSourceKind | null => {
    if (startsWith(source, PNG_SIGNATURE)) return 'png';
    if (startsWith(source, [0xff, 0xd8, 0xff])) return 'jpeg';
    if (ascii(source.subarray(0, 6)).startsWith('GIF8')) return 'gif';
    if (
        ascii(source.subarray(0, 4)) === 'RIFF' &&
        ascii(source.subarray(8, 12)) === 'WEBP'
    )
        return 'webp';
    if (startsWith(source, [0, 0, 1, 0])) return 'ico';
    if (/<svg\b/iu.test(new TextDecoder().decode(source.subarray(0, 1_024))))
        return 'svg';
    return null;
};
export const prepareFaviconSource = async (
    source: Uint8Array,
): Promise<PreparedFaviconSource> => {
    if (source.byteLength === 0 || source.byteLength > MAX_SOURCE_BYTES)
        throw new FaviconSourceError('invalid');
    const kind = faviconSourceKind(source);
    if (kind === null) throw new FaviconSourceError('unsupported');
    if (kind === 'svg') validateSvg(source);
    if (kind === 'ico') return { bytes: await prepareIco(source), kind: 'png' };
    return { bytes: source, kind };
};
