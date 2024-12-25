import classes from './ColorSchemeSwitcher.module.css';

import {
    ActionIcon,
    useComputedColorScheme,
    useMantineColorScheme,
} from '@mantine/core';
import { IconMoon, IconSun } from '@tabler/icons-react';
import cx from 'clsx';

export default function ColorSchemeSwitcher() {
    const { setColorScheme } = useMantineColorScheme();
    const computedColorScheme = useComputedColorScheme('light', {
        getInitialValueInEffect: true,
    });

    return (
        <ActionIcon
            onClick={() =>
                setColorScheme(
                    computedColorScheme === 'light' ? 'dark' : 'light',
                )
            }
            variant="default"
            size="xl"
            aria-label="Toggle color scheme"
        >
            <IconSun className={cx(classes.icon, classes.light)} stroke={1.5} />
            <IconMoon className={cx(classes.icon, classes.dark)} stroke={1.5} />
        </ActionIcon>
    );
}
