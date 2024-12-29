import classes from './ColorSchemeSwitcher.module.css';

import {
    ActionIcon,
    useComputedColorScheme,
    useMantineColorScheme,
} from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import { IconMoon, IconSun } from '@tabler/icons-react';
import cx from 'clsx';

export default function ColorSchemeSwitcher() {
    const { setColorScheme } = useMantineColorScheme();
    const computedColorScheme = useComputedColorScheme('light', {
        getInitialValueInEffect: true,
    });

    useHotkeys([
        [
            'mod+j',
            () =>
                computedColorScheme === 'light'
                    ? setColorScheme('dark')
                    : setColorScheme('light'),
        ],
    ]);

    return (
        <ActionIcon
            onClick={() =>
                setColorScheme(
                    computedColorScheme === 'light' ? 'dark' : 'light',
                )
            }
            variant="default"
            size="lg"
            aria-label="Toggle color scheme"
            mt={1}
        >
            <IconSun className={cx(classes.icon, classes.light)} stroke={1.5} />
            <IconMoon className={cx(classes.icon, classes.dark)} stroke={1.5} />
        </ActionIcon>
    );
}
