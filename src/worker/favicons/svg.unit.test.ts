import { describe, expect, it } from 'vitest';

import { FaviconSourceError } from './source';
import { sanitizeSvg } from './svg';

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);
const decode = (value: Uint8Array): string => new TextDecoder().decode(value);

describe('favicon SVG sanitizer', () => {
    it('preserves safe vector shapes, local references, and styles', async () => {
        const source =
            encode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
            <style>.brand { fill: #609926; stroke-width: 2; unknown: remove }</style>
            <defs><linearGradient id="paint"><stop offset="0" stop-color="#fff" /></linearGradient></defs>
            <path class="brand" fill="url(#paint)" d="M0 0h32v32H0z" />
            <use href="#paint" />
        </svg>`);

        await expect(sanitizeSvg(source).then(decode)).resolves.toBe(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>.brand{fill:#609926;stroke-width:2}</style><defs><linearGradient id="paint"><stop offset="0" stop-color="#fff"/></linearGradient></defs><path class="brand" fill="url(#paint)" d="M0 0h32v32H0z"/><use href="#paint"/></svg>',
        );
    });

    it('drops unsupported elements and attributes', async () => {
        const source =
            encode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" data-private="remove">
            <metadata>remove me</metadata>
            <filter id="expensive"><feGaussianBlur stdDeviation="999" /></filter>
            <path data-extra="remove" mask='image("https://private.example/mask")' style="fill:#123;unknown:value" d="M0 0h32v32H0z" />
        </svg>`);

        await expect(sanitizeSvg(source).then(decode)).resolves.toBe(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path style="fill:#123" d="M0 0h32v32H0z"/></svg>',
        );
    });

    it('drops XML-encoded external CSS references', async () => {
        const source = encode(
            '<svg><path mask="im&#97;ge(&quot;https://private.example/x&quot;)" fill="u&#114;l(https://private.example/y)"/></svg>',
        );

        await expect(sanitizeSvg(source).then(decode)).resolves.toBe(
            '<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>',
        );
    });

    it.each([
        '<svg><script>alert(1)</script></svg>',
        '<svg onload="alert(1)"/>',
        '<svg><a href="https://example.test">click</a></svg>',
        '<!DOCTYPE svg><svg/>',
        '<svg><path></svg>',
    ])('rejects active SVG input before serialization', async (source) => {
        await expect(sanitizeSvg(encode(source))).rejects.toBeInstanceOf(
            FaviconSourceError,
        );
    });

    it('rejects sanitized output above the stored asset limit', async () => {
        const path = 'M0 0 '.repeat(4_000);
        const paths = Array.from(
            { length: 6 },
            () => `<path d="${path}"/>`,
        ).join('');
        const source = encode(
            `<svg xmlns="http://www.w3.org/2000/svg">${paths}</svg>`,
        );

        await expect(sanitizeSvg(source)).rejects.toBeInstanceOf(
            FaviconSourceError,
        );
    });
});
