import { Affix, Paper, Select, useMantineColorScheme } from '@mantine/core';
import { IconDeviceDesktop, IconMoon, IconSun } from '@tabler/icons-react';

const colorSchemes = [
    { value: 'auto', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
] as const;

export function ColorSchemeControl() {
    const { colorScheme, setColorScheme } = useMantineColorScheme();
    const Icon =
        colorScheme === 'light'
            ? IconSun
            : colorScheme === 'dark'
              ? IconMoon
              : IconDeviceDesktop;

    return (
        <Affix
            position={{ bottom: 12, right: 12 }}
            withinPortal={false}
            zIndex={200}
        >
            <Paper p={4} shadow="sm" withBorder>
                <Select
                    aria-label="Color scheme"
                    allowDeselect={false}
                    data={colorSchemes}
                    leftSection={<Icon aria-hidden="true" size={15} />}
                    onChange={(value) => {
                        if (
                            value === 'auto' ||
                            value === 'light' ||
                            value === 'dark'
                        ) {
                            setColorScheme(value);
                        }
                    }}
                    size="xs"
                    value={colorScheme}
                    w={118}
                />
            </Paper>
        </Affix>
    );
}
