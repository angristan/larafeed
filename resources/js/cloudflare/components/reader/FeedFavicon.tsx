import { Center } from '@mantine/core';
import { IconRss } from '@tabler/icons-react';

import classes from './Reader.module.css';

interface FeedFaviconProps {
    readonly src: string | null;
    readonly isDark: boolean | null;
    readonly size?: number;
}

export function FeedFavicon({ src, isDark, size = 18 }: FeedFaviconProps) {
    if (src === null) {
        return (
            <Center
                aria-hidden="true"
                className={classes.faviconFallback}
                style={{ width: size, height: size }}
            >
                <IconRss size={Math.max(12, size - 4)} />
            </Center>
        );
    }

    return (
        <img
            alt=""
            aria-hidden="true"
            className={isDark === false ? classes.favicon : classes.faviconDark}
            height={size}
            loading="lazy"
            src={src}
            width={size}
        />
    );
}
