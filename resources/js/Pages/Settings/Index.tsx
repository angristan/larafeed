import { AppShell, Stack, Text, Title } from '@mantine/core';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import AppShellLayout from '@/Layouts/AppShellLayout/AppShellLayout';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import SettingsSidebar from './components/SettingsSidebar';
import OpmlSettings from './sections/OpmlSettings';
import ProfileSettings from './sections/ProfileSettings';
import TwoFactorSettings from './sections/TwoFactorSettings';
import type { SettingsPageProps, SettingsSection } from './types';

const Settings = ({
    mustVerifyEmail,
    status,
    initialSection = 'profile',
    twoFactorEnabled,
    twoFactorConfirmed,
}: SettingsPageProps) => {
    const [section, setSection] = useState<SettingsSection>(initialSection);

    const handleSectionChange = useCallback((newSection: SettingsSection) => {
        setSection(newSection);
        const url = new URL(window.location.href);
        if (newSection === 'profile') {
            url.searchParams.delete('section');
        } else {
            url.searchParams.set('section', newSection);
        }
        window.history.replaceState({}, '', url.toString());
    }, []);

    const content = useMemo(() => {
        if (section === 'opml') {
            return <OpmlSettings />;
        }

        if (section === 'security') {
            return (
                <TwoFactorSettings
                    twoFactorEnabled={twoFactorEnabled}
                    twoFactorConfirmed={twoFactorConfirmed}
                />
            );
        }

        return (
            <ProfileSettings
                mustVerifyEmail={mustVerifyEmail}
                status={status}
            />
        );
    }, [
        section,
        mustVerifyEmail,
        status,
        twoFactorEnabled,
        twoFactorConfirmed,
    ]);

    return (
        <AppShellLayout
            activePage="settings"
            sidebar={
                <SettingsSidebar
                    activeSection={section}
                    onSelect={handleSectionChange}
                />
            }
        >
            <AppShell.Main>
                <Stack gap="xl" maw={720} mx="auto" my="md">
                    <Stack gap={4}>
                        <Title order={1}>Settings</Title>
                        <Text size="sm" c="dimmed">
                            Manage your account, preferences, and data
                            import/export tools.
                        </Text>
                    </Stack>

                    {content}
                </Stack>
            </AppShell.Main>
        </AppShellLayout>
    );
};

Settings.layout = (page: ReactNode) => (
    <AuthenticatedLayout pageTitle="Settings">{page}</AuthenticatedLayout>
);

export default Settings;
