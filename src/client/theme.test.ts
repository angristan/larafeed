import { DEFAULT_THEME, mergeMantineTheme } from '@mantine/core';
import { describe, expect, it } from 'vitest';

import { cssVariablesResolver, theme } from './theme';

const channel = (value: number): number => {
    const srgb = value / 255;
    return srgb <= 0.039_28 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string): number => {
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
    if (match === null) throw new Error(`Expected a hex color, got ${hex}`);
    const [red, green, blue] = match
        .slice(1)
        .map((part) => channel(Number.parseInt(part, 16)));
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrast = (foreground: string, background: string): number => {
    const [lighter, darker] = [luminance(foreground), luminance(background)]
        .sort((left, right) => right - left)
        .map((value) => value + 0.05);
    return lighter / darker;
};

describe('theme text contrast', () => {
    const variables = cssVariablesResolver(
        mergeMantineTheme(DEFAULT_THEME, theme),
    );

    for (const scheme of ['light', 'dark'] as const) {
        const palette: Readonly<Record<string, string>> = variables[scheme];

        it(`keeps secondary text readable on ${scheme} surfaces`, () => {
            for (const text of [
                '--mantine-color-dimmed',
                '--ds-muted',
                '--ds-subtle',
            ]) {
                for (const surface of [
                    '--ds-canvas',
                    '--ds-paper',
                    '--ds-paper-muted',
                ]) {
                    expect(
                        contrast(palette[text], palette[surface]),
                        `${text} on ${surface}`,
                    ).toBeGreaterThanOrEqual(4.5);
                }
            }
        });
    }
});
