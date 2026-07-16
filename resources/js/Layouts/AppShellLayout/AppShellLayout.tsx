import { Link, router, usePage } from '@inertiajs/react';
import {
    ActionIcon,
    AppShell,
    Avatar,
    Burger,
    Group,
    Menu,
    rem,
    Text,
    Title,
    Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
    Spotlight,
    type SpotlightActionData,
    spotlight as spotlightActions,
} from '@mantine/spotlight';
import {
    IconBook2,
    IconBrandGithub,
    IconChartBar,
    IconList,
    IconLogout,
    IconMenu2,
    IconSearch,
    IconSettings,
} from '@tabler/icons-react';
import {
    createContext,
    type ReactNode,
    useContext,
    useEffect,
    useMemo,
} from 'react';
import ApplicationLogo from '@/Components/ApplicationLogo/ApplicationLogo';
import ColorSchemeSwitcher from '@/Components/ColorSchemeSwitcher/ColorSchemeSwitcher';
import KeyboardShortcuts from '@/Components/KeyboardShortcuts/KeyboardShortcuts';
import type { PageProps } from '@/types';
import classes from './AppShellLayout.module.css';

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

const CloseSidebarContext = createContext<() => void>(() => undefined);

export const useCloseAppShellSidebar = () => useContext(CloseSidebarContext);

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

    const [opened, { close, toggle }] = useDisclosure();

    const hasSidebar = Boolean(sidebar);

    useEffect(
        () =>
            router.on('start', (event) => {
                if (!event.detail.visit.prefetch) {
                    close();
                }
            }),
        [close],
    );

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
            header={{ height: 64 }}
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
            classNames={{
                navbar: !opened ? classes.mobileNavbarClosed : undefined,
            }}
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

            <AppShell.Header className={classes.header}>
                <Group
                    h="100%"
                    px={{ base: 'sm', sm: 'md' }}
                    justify="space-between"
                    wrap="nowrap"
                >
                    <Group gap="sm" wrap="nowrap">
                        {hasSidebar && (
                            <Burger
                                opened={opened}
                                onClick={toggle}
                                hiddenFrom="sm"
                                size="sm"
                                aria-controls="app-sidebar-navigation"
                                aria-expanded={opened}
                                aria-label={
                                    opened
                                        ? 'Close page navigation'
                                        : 'Open page navigation'
                                }
                            />
                        )}
                        <Link
                            href={route('feeds.index')}
                            prefetch
                            className={classes.logoLink}
                            aria-label="Larafeed reader"
                        >
                            <Group gap="xs" wrap="nowrap">
                                <ApplicationLogo width={34} />
                                <Title order={3} className={classes.brandName}>
                                    Larafeed
                                </Title>
                            </Group>
                        </Link>

                        <nav
                            className={classes.desktopNav}
                            aria-label="Primary navigation"
                        >
                            {NAV_ITEMS.map((item) => {
                                const Icon = item.icon;

                                return (
                                    <Link
                                        key={item.key}
                                        href={route(item.routeName)}
                                        prefetch
                                        className={`${classes.navLink} ${
                                            item.key === activePage
                                                ? classes.navLinkActive
                                                : ''
                                        }`}
                                        aria-current={
                                            item.key === activePage
                                                ? 'page'
                                                : undefined
                                        }
                                    >
                                        <Icon size={17} stroke={1.7} />
                                        <span>{item.label}</span>
                                    </Link>
                                );
                            })}
                        </nav>
                    </Group>

                    <Group gap="xs" wrap="nowrap">
                        {spotlightProps && (
                            <Tooltip
                                label="Search feeds (Ctrl/Cmd + K)"
                                withArrow
                            >
                                <ActionIcon
                                    onClick={spotlightActions.open}
                                    variant="subtle"
                                    size="lg"
                                    aria-label="Search feeds"
                                >
                                    <IconSearch stroke={1.7} size={19} />
                                </ActionIcon>
                            </Tooltip>
                        )}

                        <Group gap="xs" visibleFrom="md" wrap="nowrap">
                            <Tooltip label="View Larafeed on GitHub" withArrow>
                                <ActionIcon
                                    component="a"
                                    href="https://github.com/angristan/larafeed"
                                    target="_blank"
                                    rel="noreferrer"
                                    variant="subtle"
                                    size="lg"
                                    aria-label="Open Larafeed GitHub repository"
                                >
                                    <IconBrandGithub stroke={1.5} size={20} />
                                </ActionIcon>
                            </Tooltip>

                            <KeyboardShortcuts />
                        </Group>

                        <ColorSchemeSwitcher />

                        <Menu shadow="md" width={210} position="bottom-end">
                            <Menu.Target>
                                <ActionIcon
                                    variant="subtle"
                                    size="lg"
                                    hiddenFrom="md"
                                    aria-label="Open primary navigation"
                                >
                                    <IconMenu2 stroke={1.7} size={20} />
                                </ActionIcon>
                            </Menu.Target>

                            <Menu.Dropdown>
                                <Menu.Label>Navigate</Menu.Label>
                                {NAV_ITEMS.map((item) => {
                                    const Icon = item.icon;

                                    return (
                                        <Menu.Item
                                            key={item.key}
                                            component={Link}
                                            href={route(item.routeName)}
                                            prefetch
                                            leftSection={
                                                <Icon size={16} stroke={1.7} />
                                            }
                                            color={
                                                item.key === activePage
                                                    ? 'blue'
                                                    : undefined
                                            }
                                            aria-current={
                                                item.key === activePage
                                                    ? 'page'
                                                    : undefined
                                            }
                                            onClick={close}
                                        >
                                            {item.label}
                                        </Menu.Item>
                                    );
                                })}
                            </Menu.Dropdown>
                        </Menu>

                        <Menu shadow="md" width={220} position="bottom-end">
                            <Menu.Target>
                                <Avatar
                                    component="button"
                                    type="button"
                                    src={null}
                                    radius="xl"
                                    size={34}
                                    className={classes.user}
                                    aria-label={`Open account menu for ${user.name}`}
                                >
                                    {user.name[0]}
                                </Avatar>
                            </Menu.Target>

                            <Menu.Dropdown>
                                <Menu.Label>
                                    <Text
                                        size="sm"
                                        fw={600}
                                        c="var(--app-text-primary)"
                                    >
                                        {user.name}
                                    </Text>
                                    <Text size="xs" c="dimmed" truncate>
                                        {user.email}
                                    </Text>
                                </Menu.Label>
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

            <CloseSidebarContext.Provider value={close}>
                {sidebar}
            </CloseSidebarContext.Provider>
            {children}
        </AppShell>
    );
};

export default AppShellLayout;
