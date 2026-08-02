import { AppShell, NavLink, ScrollArea, Stack, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
    IconFileImport,
    IconKey,
    IconList,
    IconShieldLock,
    IconUserShield,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';

import { authSessionQueryOptions } from '../queries/auth';
import {
    type ApplicationPage as ActivePage,
    ApplicationHeader,
} from './ApplicationHeader';

interface ApplicationPageProps {
    readonly activePage: ActivePage;
    readonly children: ReactNode;
    readonly settingsNavigation?: boolean;
}

function SettingsNavigation({
    onNavigate,
}: {
    readonly onNavigate: () => void;
}) {
    const location = useLocation();
    const session = useQuery(authSessionQueryOptions);
    const user =
        session.data?.authenticated === true ? session.data.user : undefined;
    const items = [
        {
            to: '/settings/security',
            label: 'Account & security',
            description: 'Profile and passkeys',
            icon: IconShieldLock,
        },
        {
            to: '/settings/subscriptions',
            label: 'Subscriptions',
            description: 'Feeds and categories',
            icon: IconList,
        },
        {
            to: '/settings/opml',
            label: 'Import & export',
            description: 'OPML and data tools',
            icon: IconFileImport,
        },
        {
            to: '/settings/app-tokens',
            label: 'App tokens',
            description: 'Reader integrations',
            icon: IconKey,
        },
        ...(user?.isAdmin === true
            ? [
                  {
                      to: '/admin/users',
                      label: 'Administration',
                      description: 'Users and access',
                      icon: IconUserShield,
                  },
              ]
            : []),
    ];

    return (
        <>
            <AppShell.Section p="md" pb="xs">
                <Text c="dimmed" fw={500} size="xs" tt="uppercase">
                    Settings
                </Text>
            </AppShell.Section>
            <AppShell.Section component={ScrollArea} grow px="md" pb="md">
                <Stack gap={4}>
                    {items.map((item) => {
                        const Icon = item.icon;
                        return (
                            <NavLink
                                key={item.to}
                                active={location.pathname === item.to}
                                component={Link}
                                description={item.description}
                                label={item.label}
                                leftSection={
                                    <Icon aria-hidden="true" size={16} />
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
}: ApplicationPageProps) {
    const [navbarOpened, navbar] = useDisclosure(false);

    return (
        <AppShell
            header={{ height: 56 }}
            navbar={
                settingsNavigation
                    ? {
                          width: 300,
                          breakpoint: 'sm',
                          collapsed: { mobile: !navbarOpened },
                      }
                    : undefined
            }
            padding="md"
        >
            <ApplicationHeader
                activePage={activePage}
                hasSidebar={settingsNavigation}
                navbarOpened={navbarOpened}
                onNavbarToggle={navbar.toggle}
            />
            {settingsNavigation && (
                <AppShell.Navbar>
                    <SettingsNavigation onNavigate={navbar.close} />
                </AppShell.Navbar>
            )}
            <AppShell.Main>{children}</AppShell.Main>
        </AppShell>
    );
}
