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
    // Apply dark styling if isDark is true OR null (couldn't analyze / no favicon)
    const needsBackground = isDark !== false;
    return (
        <Image
            src={src}
            className={clsx(
                classes.favicon,
                needsBackground && classes.faviconDark,
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
    // Apply dark styling if isDark is true OR null (couldn't analyze / no favicon)
    const needsBackground = isDark !== false;
    return (
        <Avatar
            src={src}
            className={clsx(needsBackground && classes.faviconAvatarDark)}
            {...props}
        >
            {children}
        </Avatar>
    );
}
