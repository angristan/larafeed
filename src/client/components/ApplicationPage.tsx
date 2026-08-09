import {
    AppShell,
    Group,
    NavLink,
    Paper,
    ScrollArea,
    Stack,
    type StackProps,
    Text,
    Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
    IconAdjustmentsHorizontal,
    IconFileImport,
    IconKey,
    IconShieldLock,
    IconUserCircle,
    IconUsers,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect } from 'react';
import { Link, useLocation } from 'react-router';

import { authSessionQueryOptions } from '../queries/auth';
import {
    type ApplicationPage as ActivePage,
    ApplicationHeader,
} from './ApplicationHeader';
import classes from './ApplicationPage.module.css';

interface ApplicationPageProps {
    readonly activePage: ActivePage;
    readonly children: ReactNode;
    readonly settingsNavigation?: boolean;
    readonly sidebar?: ReactNode;
    readonly pageTitle?: string;
}

interface ApplicationContentProps {
    readonly children: ReactNode;
    readonly description: string;
    readonly gap?: StackProps['gap'];
    readonly title: string;
}

function ApplicationContentLayout({
    children,
    compact,
    description,
    gap = 'xl',
    title,
}: ApplicationContentProps & { readonly compact: boolean }) {
    return (
        <Stack
            className={`${classes.content} ${
                compact ? classes.settingsContent : ''
            }`}
            gap={gap}
        >
            <header className={classes.contentHeader}>
                <Title order={1}>{title}</Title>
                <Text c="dimmed" size="sm">
                    {description}
                </Text>
            </header>
            {children}
        </Stack>
    );
}

export function ApplicationContent(props: ApplicationContentProps) {
    return <ApplicationContentLayout {...props} compact={false} />;
}

export function ApplicationSettingsContent(props: ApplicationContentProps) {
    return <ApplicationContentLayout {...props} compact />;
}

export function ApplicationWorkSurface({
    children,
}: {
    readonly children: ReactNode;
}) {
    return (
        <Paper className={classes.workSurface} p={{ base: 'md', sm: 'lg' }}>
            {children}
        </Paper>
    );
}

export function ApplicationSidebarHeader({
    action,
    children,
    description,
    title,
}: {
    readonly action?: ReactNode;
    readonly children?: ReactNode;
    readonly description: string;
    readonly title: string;
}) {
    return (
        <AppShell.Section className={classes.sidebarHeader}>
            <Group justify="space-between" wrap="nowrap">
                <Stack gap={2}>
                    <Text className={classes.sidebarTitle}>{title}</Text>
                    <Text className={classes.sidebarDescription}>
                        {description}
                    </Text>
                </Stack>
                {action}
            </Group>
            {children}
        </AppShell.Section>
    );
}

export function ApplicationSidebarNavigation({
    children,
}: {
    readonly children: ReactNode;
}) {
    return (
        <AppShell.Section
            className={classes.sidebarNavigation}
            component={ScrollArea}
            grow
        >
            <Stack gap={4}>{children}</Stack>
        </AppShell.Section>
    );
}

function SettingsNavigation({
    onNavigate,
}: {
    readonly onNavigate: () => void;
}) {
    const location = useLocation();
    const session = useQuery(authSessionQueryOptions);
    const isAdmin =
        session.data?.authenticated === true && session.data.user.isAdmin;
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
            to: '/settings/appearance',
            active: location.pathname === '/settings/appearance',
            label: 'Appearance',
            description: 'Feed list and display',
            icon: IconAdjustmentsHorizontal,
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
        ...(isAdmin
            ? [
                  {
                      to: '/admin/users',
                      active: location.pathname === '/admin/users',
                      label: 'Administration',
                      description: 'Users and access',
                      icon: IconUsers,
                  },
              ]
            : []),
    ];

    return (
        <>
            <ApplicationSidebarHeader
                description="Account and reader configuration"
                title="Settings"
            />
            <ApplicationSidebarNavigation>
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
            </ApplicationSidebarNavigation>
        </>
    );
}

export function ApplicationPage({
    activePage,
    children,
    settingsNavigation = false,
    sidebar,
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
            header={{ height: { base: 72, sm: 0 } }}
            navbar={{
                width: {
                    base: 'min(88vw, 320px)',
                    sm: hasSidebar ? 364 : 88,
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
