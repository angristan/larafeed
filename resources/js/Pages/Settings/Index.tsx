import SettingsSidebar from './components/SettingsSidebar';
import OpmlSettings from './sections/OpmlSettings';
import ProfileSettings from './sections/ProfileSettings';
import type { SettingsPageProps, SettingsSection } from './types';
import AppShellLayout from '@/Layouts/AppShellLayout/AppShellLayout';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { AppShell, Stack, Text, Title } from '@mantine/core';
import { ReactNode, useMemo, useState } from 'react';

const Settings = ({
    mustVerifyEmail,
    status,
    initialSection = 'profile',
}: SettingsPageProps) => {
    const [section, setSection] = useState<SettingsSection>(initialSection);

    const content = useMemo(() => {
        if (section === 'opml') {
            return <OpmlSettings />;
        }

        return (
            <ProfileSettings
                mustVerifyEmail={mustVerifyEmail}
                status={status}
            />
        );
    }, [section, mustVerifyEmail, status]);

    return (
        <AppShellLayout
            activePage="settings"
            sidebar={
                <SettingsSidebar
                    activeSection={section}
                    onSelect={setSection}
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
