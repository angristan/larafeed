const SAMPLE_SIZE = 10;
const MAX_ANALYSIS_DIMENSION = 32;
const BRIGHTNESS_THRESHOLD = 80;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_TRANSFORMED_BYTES = 16 * 1024;
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

export type FaviconDarknessAnalyzer = (
    source: Uint8Array,
) => Promise<boolean | null>;

const arrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    return copy;
};

const readBounded = async (
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
                throw new Error('Image output is too large');
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

const transformedBytes = async (response: Response): Promise<Uint8Array> => {
    if (!response.ok || response.body === null) throw new Error('Bad output');
    const mime = response.headers
        .get('content-type')
        ?.split(';', 1)[0]
        ?.trim()
        .toLocaleLowerCase();
    if (mime !== 'image/png') throw new Error('Unexpected output format');
    const contentLength = response.headers.get('content-length');
    if (contentLength !== null) {
        const normalized = contentLength.trim();
        if (!/^\d+$/u.test(normalized)) throw new Error('Bad output length');
        const length = Number(normalized);
        if (!Number.isSafeInteger(length) || length > MAX_TRANSFORMED_BYTES) {
            await response.body.cancel();
            throw new Error('Image output is too large');
        }
    }
    return readBounded(response.body, MAX_TRANSFORMED_BYTES);
};

interface PngImage {
    readonly width: number;
    readonly height: number;
    readonly colorType: number;
    readonly scanlines: Uint8Array;
    readonly palette: Uint8Array | null;
    readonly transparency: Uint8Array | null;
}

const equalBytes = (left: Uint8Array, right: Uint8Array): boolean =>
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index]);

const concatenate = (chunks: readonly Uint8Array[]): Uint8Array => {
    const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const bytes = new Uint8Array(size);
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

const channelsFor = (colorType: number): number => {
    switch (colorType) {
        case 0:
        case 3:
            return 1;
        case 2:
            return 3;
        case 4:
            return 2;
        case 6:
            return 4;
        default:
            throw new Error('Unsupported PNG color type');
    }
};

const parsePng = async (bytes: Uint8Array): Promise<PngImage> => {
    if (
        bytes.byteLength < PNG_SIGNATURE.byteLength ||
        !equalBytes(bytes.subarray(0, PNG_SIGNATURE.byteLength), PNG_SIGNATURE)
    ) {
        throw new Error('Invalid PNG signature');
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const decoder = new TextDecoder('ascii', { fatal: true });
    const idat: Uint8Array[] = [];
    let palette: Uint8Array | null = null;
    let transparency: Uint8Array | null = null;
    let width: number | null = null;
    let height: number | null = null;
    let colorType: number | null = null;
    let sawEnd = false;
    let offset = PNG_SIGNATURE.byteLength;

    while (offset + 12 <= bytes.byteLength) {
        const length = view.getUint32(offset);
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        const chunkEnd = dataEnd + 4;
        if (length > MAX_TRANSFORMED_BYTES || chunkEnd > bytes.byteLength)
            throw new Error('Invalid PNG chunk');
        const chunkPayload = bytes.subarray(offset + 4, dataEnd);
        if (crc32(chunkPayload) !== view.getUint32(dataEnd))
            throw new Error('Invalid PNG checksum');
        const type = decoder.decode(bytes.subarray(offset + 4, dataStart));
        const data = bytes.subarray(dataStart, dataEnd);
        if (type === 'IHDR') {
            if (colorType !== null || length !== 13)
                throw new Error('Invalid PNG header');
            width = view.getUint32(dataStart);
            height = view.getUint32(dataStart + 4);
            if (
                width < 1 ||
                width > MAX_ANALYSIS_DIMENSION ||
                height < 1 ||
                height > MAX_ANALYSIS_DIMENSION ||
                data[8] !== 8 ||
                data[10] !== 0 ||
                data[11] !== 0 ||
                data[12] !== 0
            ) {
                throw new Error('Unexpected PNG layout');
            }
            colorType = data[9] ?? null;
            channelsFor(colorType ?? -1);
        } else if (type === 'PLTE') {
            if (length === 0 || length > 768 || length % 3 !== 0)
                throw new Error('Invalid PNG palette');
            palette = data.slice();
        } else if (type === 'tRNS') {
            if (length > 256) throw new Error('Invalid PNG transparency');
            transparency = data.slice();
        } else if (type === 'IDAT') {
            if (colorType === null) throw new Error('Missing PNG header');
            idat.push(data.slice());
        } else if (type === 'IEND') {
            if (length !== 0 || chunkEnd !== bytes.byteLength)
                throw new Error('Invalid PNG end');
            sawEnd = true;
            break;
        }
        offset = chunkEnd;
    }

    if (
        width === null ||
        height === null ||
        colorType === null ||
        idat.length === 0 ||
        !sawEnd
    )
        throw new Error('Incomplete PNG');
    if (colorType === 3 && palette === null)
        throw new Error('Missing PNG palette');

    const channels = channelsFor(colorType);
    const expected = height * (1 + width * channels);
    const compressed = concatenate(idat);
    if (compressed.byteLength > MAX_TRANSFORMED_BYTES)
        throw new Error('Compressed PNG is too large');
    const compressedStream = new Response(arrayBuffer(compressed)).body;
    if (compressedStream === null) throw new Error('Missing PNG data');
    const scanlines = await readBounded(
        compressedStream.pipeThrough(new DecompressionStream('deflate')),
        expected,
    );
    if (scanlines.byteLength !== expected)
        throw new Error('Unexpected PNG data length');

    return { width, height, colorType, scanlines, palette, transparency };
};

const paeth = (left: number, above: number, upperLeft: number): number => {
    const estimate = left + above - upperLeft;
    const leftDistance = Math.abs(estimate - left);
    const aboveDistance = Math.abs(estimate - above);
    const upperLeftDistance = Math.abs(estimate - upperLeft);
    if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance)
        return left;
    return aboveDistance <= upperLeftDistance ? above : upperLeft;
};

const unfilter = (image: PngImage): Uint8Array => {
    const channels = channelsFor(image.colorType);
    const stride = image.width * channels;
    const pixels = new Uint8Array(image.height * stride);
    for (let row = 0; row < image.height; row += 1) {
        const sourceStart = row * (stride + 1);
        const targetStart = row * stride;
        const filter = image.scanlines[sourceStart];
        if (filter === undefined || filter > 4)
            throw new Error('Unsupported PNG filter');
        for (let column = 0; column < stride; column += 1) {
            const raw = image.scanlines[sourceStart + 1 + column];
            if (raw === undefined) throw new Error('Incomplete PNG row');
            const left =
                column >= channels
                    ? (pixels[targetStart + column - channels] ?? 0)
                    : 0;
            const above =
                row > 0 ? (pixels[targetStart + column - stride] ?? 0) : 0;
            const upperLeft =
                row > 0 && column >= channels
                    ? (pixels[targetStart + column - stride - channels] ?? 0)
                    : 0;
            const predictor =
                filter === 0
                    ? 0
                    : filter === 1
                      ? left
                      : filter === 2
                        ? above
                        : filter === 3
                          ? Math.floor((left + above) / 2)
                          : paeth(left, above, upperLeft);
            pixels[targetStart + column] = (raw + predictor) & 0xff;
        }
    }
    return pixels;
};

const pixel = (
    image: PngImage,
    pixels: Uint8Array,
    index: number,
): readonly [number, number, number, number] => {
    switch (image.colorType) {
        case 0: {
            const gray = pixels[index] ?? 0;
            return [gray, gray, gray, 255];
        }
        case 2: {
            const offset = index * 3;
            return [
                pixels[offset] ?? 0,
                pixels[offset + 1] ?? 0,
                pixels[offset + 2] ?? 0,
                255,
            ];
        }
        case 3: {
            const paletteIndex = pixels[index] ?? 0;
            const offset = paletteIndex * 3;
            if (
                image.palette === null ||
                offset + 2 >= image.palette.byteLength
            )
                throw new Error('Invalid PNG palette index');
            return [
                image.palette[offset] ?? 0,
                image.palette[offset + 1] ?? 0,
                image.palette[offset + 2] ?? 0,
                image.transparency?.[paletteIndex] ?? 255,
            ];
        }
        case 4: {
            const offset = index * 2;
            const gray = pixels[offset] ?? 0;
            return [gray, gray, gray, pixels[offset + 1] ?? 0];
        }
        case 6: {
            const offset = index * 4;
            return [
                pixels[offset] ?? 0,
                pixels[offset + 1] ?? 0,
                pixels[offset + 2] ?? 0,
                pixels[offset + 3] ?? 0,
            ];
        }
        default:
            throw new Error('Unsupported PNG color type');
    }
};

const darkness = async (bytes: Uint8Array): Promise<boolean | null> => {
    const image = await parsePng(bytes);
    const pixels = unfilter(image);
    let weightedBrightness = 0;
    let opacityTotal = 0;
    for (let index = 0; index < image.width * image.height; index += 1) {
        const [red, green, blue, alpha] = pixel(image, pixels, index);
        const opacity = alpha / 255;
        weightedBrightness +=
            (0.299 * red + 0.587 * green + 0.114 * blue) * opacity;
        opacityTotal += opacity;
    }
    if (opacityTotal < 0.001) return null;
    return weightedBrightness / opacityTotal < BRIGHTNESS_THRESHOLD;
};

export const analyzeNormalizedFavicon = async (
    bytes: Uint8Array,
): Promise<boolean | null> => {
    try {
        return await darkness(bytes);
    } catch {
        return null;
    }
};

export const faviconDarknessEnabled = (
    env: Pick<Env, 'IMAGES_ENABLED'>,
): boolean => env.IMAGES_ENABLED === 'true';

export const makeFaviconDarknessAnalyzer =
    (images: ImagesBinding): FaviconDarknessAnalyzer =>
    async (source) => {
        if (source.byteLength === 0 || source.byteLength > MAX_SOURCE_BYTES)
            return null;
        try {
            const stream = new Response(arrayBuffer(source)).body;
            if (stream === null) return null;
            const result = await images
                .input(stream)
                .transform({
                    width: SAMPLE_SIZE,
                    height: SAMPLE_SIZE,
                    fit: 'squeeze',
                })
                .output({ format: 'image/png', anim: false });
            return await analyzeNormalizedFavicon(
                await transformedBytes(result.response()),
            );
        } catch {
            return null;
        }
    };
