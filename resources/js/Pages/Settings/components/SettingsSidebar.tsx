import { AppShell, NavLink, Stack, Text } from '@mantine/core';
import {
    IconFileImport,
    IconShieldLock,
    IconUserCircle,
} from '@tabler/icons-react';
import { useCloseAppShellSidebar } from '@/Layouts/AppShellLayout/AppShellLayout';
import type { SettingsSection } from '../types';

interface SettingsSidebarProps {
    activeSection: SettingsSection;
    onSelect: (section: SettingsSection) => void;
}

const SettingsSidebar = ({ activeSection, onSelect }: SettingsSidebarProps) => {
    const closeSidebar = useCloseAppShellSidebar();
    const selectSection = (section: SettingsSection) => {
        onSelect(section);
        closeSidebar();
    };

    return (
        <AppShell.Navbar
            id="app-sidebar-navigation"
            aria-label="Settings sections"
        >
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
                        onClick={() => selectSection('profile')}
                        active={activeSection === 'profile'}
                        aria-current={
                            activeSection === 'profile' ? 'page' : undefined
                        }
                        label="Profile"
                        description="Account details & password"
                        leftSection={<IconUserCircle size={16} stroke={1.5} />}
                    />
                    <NavLink
                        component="button"
                        type="button"
                        onClick={() => selectSection('security')}
                        active={activeSection === 'security'}
                        aria-current={
                            activeSection === 'security' ? 'page' : undefined
                        }
                        label="Security"
                        description="Two-factor authentication"
                        leftSection={<IconShieldLock size={16} stroke={1.5} />}
                    />
                    <NavLink
                        component="button"
                        type="button"
                        onClick={() => selectSection('opml')}
                        active={activeSection === 'opml'}
                        aria-current={
                            activeSection === 'opml' ? 'page' : undefined
                        }
                        label="Import & export"
                        description="OPML and data tools"
                        leftSection={<IconFileImport size={16} stroke={1.5} />}
                    />
                </Stack>
            </AppShell.Section>
        </AppShell.Navbar>
    );
};

export default SettingsSidebar;
