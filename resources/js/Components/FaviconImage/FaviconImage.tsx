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
    return (
        <Image
            src={src}
            className={clsx(classes.favicon, isDark && classes.faviconDark)}
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
    return (
        <Avatar
            src={src}
            className={clsx(isDark && classes.faviconAvatarDark)}
            {...props}
        >
            {children}
        </Avatar>
    );
}
