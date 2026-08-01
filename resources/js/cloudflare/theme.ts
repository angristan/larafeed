import { createTheme, rem } from '@mantine/core';

export const theme = createTheme({
    colors: {
        dark: [
            '#C9C5C1',
            '#ADA9A5',
            '#918D89',
            '#666360',
            '#403D3A',
            '#33302D',
            '#2A2725',
            '#1F1D1B',
            '#171514',
            '#110F0E',
        ],
    },
    headings: {
        sizes: {
            h1: { fontSize: rem(32) },
        },
    },
    defaultRadius: 'sm',
});
