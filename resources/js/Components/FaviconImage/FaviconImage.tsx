import {
    Avatar,
    type AvatarProps,
    Image,
    type ImageProps,
} from '@mantine/core';
import clsx from 'clsx';
import type { ReactNode } from 'react';
import classes from './FaviconImage.module.css';

interface FaviconImageProps extends Omit<ImageProps, 'className'> {
    src: string | null | undefined;
    isDark?: boolean | null;
}

export function FaviconImage({ src, isDark, ...props }: FaviconImageProps) {
    // Apply background in dark mode for dark favicons or unknown brightness (conservative approach).
    // Only apply when there's an actual image to show.
    const shouldApplyDarkModeBackground = src && isDark !== false;
    return (
        <Image
            src={src}
            className={clsx(
                classes.favicon,
                shouldApplyDarkModeBackground && classes.faviconDark,
            )}
            {...props}
        />
    );
}

interface FaviconAvatarProps extends Omit<AvatarProps, 'className'> {
    src: string | null | undefined;
    isDark?: boolean | null;
    children?: ReactNode;
}

export function FaviconAvatar({
    src,
    isDark,
    children,
    ...props
}: FaviconAvatarProps) {
    // Apply background in dark mode for dark favicons or unknown brightness (conservative approach).
    // Only apply when there's an actual image to show.
    const shouldApplyDarkModeBackground = src && isDark !== false;
    return (
        <Avatar
            src={src}
            className={clsx(
                shouldApplyDarkModeBackground && classes.faviconAvatarDark,
            )}
            {...props}
        >
            {children}
        </Avatar>
    );
}
