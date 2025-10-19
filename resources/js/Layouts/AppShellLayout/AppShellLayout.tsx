import classes from './AppShellLayout.module.css';

import ApplicationLogo from '@/Components/ApplicationLogo/ApplicationLogo';
import ColorSchemeSwitcher from '@/Components/ColorSchemeSwitcher/ColorSchemeSwitcher';
import KeyboardShortcuts from '@/Components/KeyboardShortcuts/KeyboardShortcuts';
import { PageProps } from '@/types';
import { Link, router, usePage } from '@inertiajs/react';
import {
    ActionIcon,
    AppShell,
    Avatar,
    Burger,
    Group,
    Menu,
    Title,
    Tooltip,
    rem,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Spotlight, SpotlightActionData } from '@mantine/spotlight';
import {
    IconBook2,
    IconBrandGithub,
    IconChartBar,
    IconList,
    IconLogout,
    IconRss,
    IconSearch,
    IconSettings,
} from '@tabler/icons-react';
import { ReactNode, useMemo } from 'react';

interface SpotlightConfig {
    actions: SpotlightActionData[];
    shortcut?: string;
    nothingFoundLabel?: string;
    searchPlaceholder?: string;
}

interface AppShellLayoutProps {
    children: ReactNode;
    sidebar?: ReactNode;
    activePage: 'reader' | 'subscriptions' | 'charts' | 'settings';
    spotlight?: SpotlightConfig;
    navbarWidth?: number;
}

const NAV_ITEMS: Array<{
    key: 'reader' | 'subscriptions' | 'charts' | 'settings';
    label: string;
    icon: React.ElementType;
    routeName: string;
}> = [
    {
        key: 'reader',
        label: 'Reader',
        icon: IconBook2,
        routeName: 'feeds.index',
    },
    {
        key: 'subscriptions',
        label: 'Subscriptions',
        icon: IconList,
        routeName: 'subscriptions.index',
    },
    {
        key: 'charts',
        label: 'Charts',
        icon: IconChartBar,
        routeName: 'charts.index',
    },
    {
        key: 'settings',
        label: 'Settings',
        icon: IconSettings,
        routeName: 'profile.edit',
    },
];

const AppShellLayout = ({
    children,
    sidebar,
    activePage,
    spotlight,
    navbarWidth = 300,
}: AppShellLayoutProps) => {
    const {
        props: {
            auth: { user },
        },
    } = usePage<PageProps>();

    const [opened, { toggle }] = useDisclosure();

    const hasSidebar = Boolean(sidebar);

    const spotlightProps = useMemo(() => {
        if (!spotlight || spotlight.actions.length === 0) {
            return null;
        }

        return {
            shortcut: spotlight.shortcut ?? 'mod + K',
            actions: spotlight.actions,
            nothingFound: spotlight.nothingFoundLabel ?? 'Nothing found...',
            searchPlaceholder: spotlight.searchPlaceholder ?? 'Search...',
        };
    }, [spotlight]);

    return (
        <AppShell
            header={{ height: 56 }}
            navbar={
                hasSidebar
                    ? {
                          width: navbarWidth,
                          breakpoint: 'sm',
                          collapsed: { mobile: !opened },
                      }
                    : undefined
            }
            padding="md"
        >
            {spotlightProps && (
                <Spotlight
                    shortcut={spotlightProps.shortcut}
                    actions={spotlightProps.actions}
                    nothingFound={spotlightProps.nothingFound}
                    highlightQuery
                    scrollable
                    maxHeight="calc(100vh * 0.6)"
                    searchProps={{
                        leftSection: (
                            <IconSearch
                                style={{ width: rem(20), height: rem(20) }}
                                stroke={1.5}
                            />
                        ),
                        placeholder: spotlightProps.searchPlaceholder,
                    }}
                />
            )}

            <AppShell.Header>
                <Group h="100%" px="md" justify="space-between">
                    <Group gap="sm">
                        {hasSidebar && (
                            <Burger
                                opened={opened}
                                onClick={toggle}
                                hiddenFrom="sm"
                                size="sm"
                            />
                        )}
                        <Link
                            href={route('feeds.index')}
                            as="div"
                            prefetch
                            className={classes.logoLink}
                        >
                            <Group gap="xs">
                                <ApplicationLogo width={36} />
                                <Title order={3} style={{ margin: 0 }}>
                                    Larafeed
                                </Title>
                            </Group>
                        </Link>

                        <Group gap={4} wrap="nowrap">
                            {NAV_ITEMS.map((item) => {
                                const Icon = item.icon;

                                return (
                                    <Tooltip
                                        key={item.key}
                                        label={item.label}
                                        withArrow
                                        openDelay={400}
                                    >
                                        <Link
                                            href={route(item.routeName)}
                                            as="div"
                                            prefetch
                                        >
                                            <ActionIcon
                                                size="lg"
                                                variant={
                                                    item.key === activePage
                                                        ? 'filled'
                                                        : 'subtle'
                                                }
                                                aria-label={`${item.label} page`}
                                            >
                                                <Icon size={18} stroke={1.6} />
                                            </ActionIcon>
                                        </Link>
                                    </Tooltip>
                                );
                            })}
                        </Group>
                    </Group>

                    <Group>
                        <ActionIcon
                            onClick={() =>
                                window.open(
                                    'https://github.com/angristan/larafeed',
                                    '_blank',
                                )
                            }
                            variant="default"
                            size="lg"
                            aria-label="Open Larafeed GitHub repository"
                        >
                            <IconBrandGithub stroke={1.5} size={20} />
                        </ActionIcon>

                        <KeyboardShortcuts />
                        <ColorSchemeSwitcher />

                        <Menu
                            shadow="md"
                            width={220}
                            position="top-end"
                            trigger="click-hover"
                            closeDelay={300}
                        >
                            <Menu.Target>
                                <Avatar
                                    src={null}
                                    radius="xl"
                                    className={classes.user}
                                >
                                    {user.name[0]}
                                </Avatar>
                            </Menu.Target>

                            <Menu.Dropdown>
                                <Menu.Label>{user.email}</Menu.Label>
                                <Menu.Divider />
                                <Menu.Item
                                    onClick={() => router.post(route('logout'))}
                                    leftSection={
                                        <IconLogout
                                            style={{
                                                width: rem(14),
                                                height: rem(14),
                                            }}
                                        />
                                    }
                                >
                                    Logout
                                </Menu.Item>
                            </Menu.Dropdown>
                        </Menu>
                    </Group>
                </Group>
            </AppShell.Header>

            {sidebar}
            {children}
        </AppShell>
    );
};

export default AppShellLayout;
