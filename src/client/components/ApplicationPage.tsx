import { AppShell, NavLink, ScrollArea, Stack, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
    IconFileImport,
    IconKey,
    IconShieldLock,
    IconUserCircle,
} from '@tabler/icons-react';
import { type ReactNode, useEffect } from 'react';
import { Link, useLocation } from 'react-router';

import {
    type ApplicationPage as ActivePage,
    ApplicationHeader,
} from './ApplicationHeader';

interface ApplicationPageProps {
    readonly activePage: ActivePage;
    readonly children: ReactNode;
    readonly settingsNavigation?: boolean;
    readonly sidebar?: ReactNode;
    readonly navbarWidth?: number;
    readonly pageTitle?: string;
}

function SettingsNavigation({
    onNavigate,
}: {
    readonly onNavigate: () => void;
}) {
    const location = useLocation();
    const items = [
        {
            to: '/settings/security#profile',
            active:
                location.pathname === '/settings/security' &&
                location.hash !== '#security',
            label: 'Profile',
            description: 'Account details and data',
            icon: IconUserCircle,
        },
        {
            to: '/settings/security#security',
            active:
                location.pathname === '/settings/security' &&
                location.hash === '#security',
            label: 'Security',
            description: 'Passkeys and account recovery',
            icon: IconShieldLock,
        },
        {
            to: '/settings/app-tokens',
            active: location.pathname === '/settings/app-tokens',
            label: 'App tokens',
            description: 'Reader client credentials',
            icon: IconKey,
        },
        {
            to: '/settings/opml',
            active: location.pathname === '/settings/opml',
            label: 'Import & export',
            description: 'OPML and data tools',
            icon: IconFileImport,
        },
    ];

    return (
        <>
            <AppShell.Section p="lg" pb="sm">
                <Stack gap={2}>
                    <Text fw={750} size="sm">
                        Settings
                    </Text>
                    <Text c="dimmed" size="xs">
                        Account and reader configuration
                    </Text>
                </Stack>
            </AppShell.Section>
            <AppShell.Section component={ScrollArea} grow px="md" pb="md">
                <Stack gap={4}>
                    {items.map((item) => {
                        const Icon = item.icon;
                        return (
                            <NavLink
                                key={item.to}
                                active={item.active}
                                component={Link}
                                description={item.description}
                                label={item.label}
                                leftSection={
                                    <Icon
                                        aria-hidden="true"
                                        size={16}
                                        stroke={1.5}
                                    />
                                }
                                onClick={onNavigate}
                                to={item.to}
                            />
                        );
                    })}
                </Stack>
            </AppShell.Section>
        </>
    );
}

export function ApplicationPage({
    activePage,
    children,
    settingsNavigation = false,
    sidebar,
    navbarWidth = 300,
    pageTitle,
}: ApplicationPageProps) {
    const [navbarOpened, navbar] = useDisclosure(false);
    const resolvedTitle =
        pageTitle ??
        (
            {
                reader: 'Reader',
                subscriptions: 'Subscriptions',
                charts: 'Charts',
                settings: 'Settings',
            } satisfies Record<ActivePage, string>
        )[activePage];

    useEffect(() => {
        document.title = `${resolvedTitle} - Larafeed`;
        return () => {
            document.title = 'Larafeed';
        };
    }, [resolvedTitle]);
    const hasSidebar = settingsNavigation || sidebar !== undefined;
    const resolvedSidebar = hasSidebar
        ? (sidebar ?? <SettingsNavigation onNavigate={navbar.close} />)
        : undefined;

    return (
        <AppShell
            header={{ height: { base: 58, sm: 0 } }}
            navbar={{
                width: {
                    base: 'min(88vw, 320px)',
                    sm: 64 + (hasSidebar ? navbarWidth : 0),
                },
                breakpoint: 'sm',
                collapsed: { mobile: !hasSidebar || !navbarOpened },
            }}
            padding={{ base: 'md', sm: 'lg' }}
        >
            <ApplicationHeader
                activePage={activePage}
                hasSidebar={hasSidebar}
                navbarOpened={navbarOpened}
                onNavbarToggle={navbar.toggle}
                sidebar={resolvedSidebar}
                sidebarLabel={
                    settingsNavigation ? 'Settings navigation' : undefined
                }
            />
            <AppShell.Main>{children}</AppShell.Main>
        </AppShell>
    );
}
