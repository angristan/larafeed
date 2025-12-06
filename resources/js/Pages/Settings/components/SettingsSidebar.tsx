import { AppShell, NavLink, Stack, Text } from '@mantine/core';
import { IconFileImport, IconUserCircle } from '@tabler/icons-react';
import type { SettingsSection } from '../types';

interface SettingsSidebarProps {
    activeSection: SettingsSection;
    onSelect: (section: SettingsSection) => void;
}

const SettingsSidebar = ({ activeSection, onSelect }: SettingsSidebarProps) => (
    <AppShell.Navbar>
        <AppShell.Section p="md" pb="xs">
            <Text size="xs" c="dimmed" fw={500} tt="uppercase">
                Settings
            </Text>
        </AppShell.Section>
        <AppShell.Section px="md" pb="md">
            <Stack gap={4}>
                <NavLink
                    component="button"
                    type="button"
                    onClick={() => onSelect('profile')}
                    active={activeSection === 'profile'}
                    label="Profile"
                    description="Account details & password"
                    leftSection={<IconUserCircle size={16} stroke={1.5} />}
                />
                <NavLink
                    component="button"
                    type="button"
                    onClick={() => onSelect('opml')}
                    active={activeSection === 'opml'}
                    label="Import & export"
                    description="OPML and data tools"
                    leftSection={<IconFileImport size={16} stroke={1.5} />}
                />
            </Stack>
        </AppShell.Section>
    </AppShell.Navbar>
);

export default SettingsSidebar;
