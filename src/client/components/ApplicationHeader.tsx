import '@mantine/spotlight/styles.css';

import {
    ActionIcon,
    AppShell,
    Avatar,
    Burger,
    Group,
    Menu,
    rem,
    Text,
    Tooltip,
    useComputedColorScheme,
    useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure, useHotkeys } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { Spotlight, type SpotlightActionData } from '@mantine/spotlight';
import {
    IconBook2,
    IconBrandGithub,
    IconChartBar,
    IconKeyboard,
    IconList,
    IconLogout,
    IconMoon,
    IconSearch,
    IconSettings,
    IconSun,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Effect } from 'effect';
import { type ReactNode, useMemo } from 'react';
import { Link, useNavigate } from 'react-router';

import { AuthClientError, logout, readCsrfToken } from '../api/auth';
import { accountQueryOptions } from '../queries/account';
import {
    authKeys,
    authSessionQueryOptions,
    clearAuthenticatedCache,
    isUnauthenticatedError,
} from '../queries/auth';
import { subscriptionListQueryOptions } from '../queries/reader';
import classes from './ApplicationHeader.module.css';
import ApplicationLogo from './ApplicationLogo';
import { FeedFavicon } from './reader/FeedFavicon';
import { ReaderShortcutHelp } from './reader/ReaderShortcutHelp';

export type ApplicationPage =
    | 'reader'
    | 'subscriptions'
    | 'charts'
    | 'settings';

interface ApplicationHeaderProps {
    readonly activePage: ApplicationPage;
    readonly hasSidebar?: boolean;
    readonly navbarOpened?: boolean;
    readonly onNavbarToggle?: () => void;
    readonly sidebar?: ReactNode;
    readonly sidebarLabel?: string;
}

const navigation = [
    { key: 'reader', label: 'Reader', icon: IconBook2, to: '/feeds' },
    {
        key: 'subscriptions',
        label: 'Subscriptions',
        icon: IconList,
        to: '/settings/subscriptions',
    },
    { key: 'charts', label: 'Charts', icon: IconChartBar, to: '/charts' },
    {
        key: 'settings',
        label: 'Settings',
        icon: IconSettings,
        to: '/settings/security',
    },
] as const;

export function ApplicationHeader({
    activePage,
    hasSidebar = false,
    navbarOpened = false,
    onNavbarToggle,
    sidebar,
    sidebarLabel = 'Context navigation',
}: ApplicationHeaderProps) {
    const session = useQuery(authSessionQueryOptions);
    const profile = useQuery(accountQueryOptions);
    const subscriptions = useQuery(subscriptionListQueryOptions);
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const [shortcutsOpened, shortcuts] = useDisclosure(false);
    const { setColorScheme } = useMantineColorScheme();
    const computedColorScheme = useComputedColorScheme('light', {
        getInitialValueInEffect: true,
    });

    const toggleColorScheme = () =>
        setColorScheme(computedColorScheme === 'light' ? 'dark' : 'light');

    useHotkeys([
        ['shift+?', shortcuts.toggle],
        ['mod+j', toggleColorScheme],
    ]);

    const logoutMutation = useMutation({
        mutationKey: [...authKeys.all, 'logout'],
        retry: false,
        mutationFn: () => {
            const csrfToken = readCsrfToken();
            if (csrfToken === undefined) {
                return Effect.runPromise(
                    Effect.fail(
                        new AuthClientError(
                            'status',
                            'Your session security token is missing. Sign in again.',
                            401,
                            'unauthenticated',
                        ),
                    ),
                );
            }
            return Effect.runPromise(logout(csrfToken));
        },
        onSuccess: () => {
            clearAuthenticatedCache(queryClient);
            void navigate('/login', { replace: true });
        },
        onError: (error) => {
            if (isUnauthenticatedError(error)) {
                void navigate('/login', { replace: true });
                return;
            }
            notifications.show({
                color: 'red',
                title: 'Sign-out failed',
                message: error.message,
            });
        },
    });

    const user =
        session.data?.authenticated === true ? session.data.user : undefined;
    const spotlightActions = useMemo<SpotlightActionData[]>(
        () =>
            (subscriptions.data?.subscriptions ?? []).map((subscription) => {
                const label =
                    subscription.customFeedName ?? subscription.feedName;
                return {
                    id: `feed-${subscription.feedId}`,
                    label,
                    description:
                        subscription.customFeedName === null
                            ? undefined
                            : subscription.feedName,
                    leftSection: (
                        <FeedFavicon
                            isDark={subscription.faviconIsDark}
                            size={20}
                            src={subscription.faviconUrl}
                        />
                    ),
                    onClick: () =>
                        void navigate(
                            `/feeds?feed=${subscription.feedId}&filter=all&order_by=published_at`,
                        ),
                };
            }),
        [navigate, subscriptions.data?.subscriptions],
    );

    const accountMenu = (placement: 'rail' | 'header') =>
        user === undefined ? null : (
            <Menu
                closeDelay={300}
                position={placement === 'rail' ? 'right-end' : 'bottom-end'}
                shadow="md"
                trigger="click-hover"
                width={230}
            >
                <Menu.Target>
                    <Avatar
                        aria-label={`Signed in as ${user.displayName}`}
                        className={classes.user}
                        component="button"
                        radius="sm"
                        type="button"
                    >
                        {user.displayName[0]}
                    </Avatar>
                </Menu.Target>
                <Menu.Dropdown>
                    <Menu.Label>
                        {profile.data?.email ?? `@${user.username}`}
                    </Menu.Label>
                    <Menu.Divider />
                    <Menu.Item
                        disabled={logoutMutation.isPending}
                        leftSection={
                            <IconLogout
                                style={{ width: rem(14), height: rem(14) }}
                            />
                        }
                        onClick={() => logoutMutation.mutate()}
                    >
                        Sign out
                    </Menu.Item>
                </Menu.Dropdown>
            </Menu>
        );

    return (
        <>
            {spotlightActions.length > 0 && (
                <Spotlight
                    actions={spotlightActions}
                    highlightQuery
                    maxHeight="calc(100vh * 0.6)"
                    nothingFound="No feeds found"
                    scrollable
                    searchProps={{
                        leftSection: (
                            <IconSearch
                                style={{ width: rem(20), height: rem(20) }}
                                stroke={1.5}
                            />
                        ),
                        placeholder: 'Find a feed',
                    }}
                    shortcut="mod + K"
                />
            )}

            <AppShell.Header className={classes.mobileHeader}>
                <Group
                    className={classes.mobileHeaderInner}
                    h="100%"
                    justify="space-between"
                    wrap="nowrap"
                >
                    <Group gap="sm" wrap="nowrap">
                        {hasSidebar && (
                            <Burger
                                aria-label="Toggle navigation"
                                onClick={onNavbarToggle}
                                opened={navbarOpened}
                                size="sm"
                            />
                        )}
                        <Link className={classes.mobileBrand} to="/feeds">
                            <ApplicationLogo width={28} />
                            <Text fw={750}>Larafeed</Text>
                        </Link>
                    </Group>
                    <Group
                        className={classes.mobileUtilities}
                        gap={4}
                        wrap="nowrap"
                    >
                        {spotlightActions.length > 0 && (
                            <ActionIcon
                                aria-label="Search feeds"
                                onClick={Spotlight.open}
                                size="lg"
                                variant="subtle"
                            >
                                <IconSearch size={18} stroke={1.7} />
                            </ActionIcon>
                        )}
                        <ActionIcon
                            aria-label="Toggle color scheme"
                            onClick={toggleColorScheme}
                            size="lg"
                            variant="subtle"
                        >
                            {computedColorScheme === 'light' ? (
                                <IconSun stroke={1.7} size={18} />
                            ) : (
                                <IconMoon stroke={1.7} size={18} />
                            )}
                        </ActionIcon>
                        {accountMenu('header')}
                    </Group>
                </Group>
            </AppShell.Header>

            <AppShell.Navbar
                aria-label={sidebarLabel}
                className={classes.workspaceNavbar}
                withBorder={false}
            >
                <aside className={classes.desktopRail}>
                    <Link
                        aria-label="Larafeed reader"
                        className={classes.railBrand}
                        to="/feeds"
                    >
                        <ApplicationLogo width={30} />
                    </Link>

                    <nav
                        aria-label="Primary navigation"
                        className={classes.railNavigation}
                    >
                        {navigation.map((item) => {
                            const Icon = item.icon;
                            const active = item.key === activePage;
                            return (
                                <Tooltip
                                    key={item.key}
                                    label={item.label}
                                    openDelay={350}
                                    position="right"
                                    withArrow
                                >
                                    <Link
                                        aria-current={
                                            active ? 'page' : undefined
                                        }
                                        aria-label={`${item.label} page`}
                                        className={classes.railLink}
                                        data-active={active || undefined}
                                        to={item.to}
                                    >
                                        <Icon
                                            aria-hidden="true"
                                            size={20}
                                            stroke={1.65}
                                        />
                                    </Link>
                                </Tooltip>
                            );
                        })}
                    </nav>

                    <div className={classes.railUtilities}>
                        {spotlightActions.length > 0 && (
                            <Tooltip label="Find a feed" position="right">
                                <ActionIcon
                                    aria-label="Search feeds"
                                    onClick={Spotlight.open}
                                    size="lg"
                                    variant="subtle"
                                >
                                    <IconSearch size={19} stroke={1.65} />
                                </ActionIcon>
                            </Tooltip>
                        )}
                        <Tooltip label="Keyboard shortcuts" position="right">
                            <ActionIcon
                                aria-label="Keyboard shortcuts"
                                onClick={shortcuts.open}
                                size="lg"
                                variant="subtle"
                            >
                                <IconKeyboard size={19} stroke={1.65} />
                            </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Change color scheme" position="right">
                            <ActionIcon
                                aria-label="Toggle color scheme"
                                onClick={toggleColorScheme}
                                size="lg"
                                variant="subtle"
                            >
                                {computedColorScheme === 'light' ? (
                                    <IconSun stroke={1.65} size={19} />
                                ) : (
                                    <IconMoon stroke={1.65} size={19} />
                                )}
                            </ActionIcon>
                        </Tooltip>
                        <Tooltip label="GitHub repository" position="right">
                            <ActionIcon
                                aria-label="Open Larafeed GitHub repository"
                                component="a"
                                href="https://github.com/angristan/larafeed"
                                rel="noopener noreferrer"
                                size="lg"
                                target="_blank"
                                variant="subtle"
                            >
                                <IconBrandGithub size={19} stroke={1.65} />
                            </ActionIcon>
                        </Tooltip>
                        {accountMenu('rail')}
                    </div>
                </aside>

                {sidebar !== undefined && (
                    <div className={classes.contextPane}>{sidebar}</div>
                )}
            </AppShell.Navbar>

            <nav
                aria-label="Primary navigation"
                className={classes.mobileNavigation}
            >
                {navigation.map((item) => {
                    const Icon = item.icon;
                    const active = item.key === activePage;
                    return (
                        <Link
                            key={item.key}
                            aria-current={active ? 'page' : undefined}
                            aria-label={`${item.label} page`}
                            className={classes.mobileNavigationLink}
                            data-active={active || undefined}
                            to={item.to}
                        >
                            <Icon aria-hidden="true" size={19} stroke={1.7} />
                            <span>{item.label}</span>
                        </Link>
                    );
                })}
            </nav>

            <ReaderShortcutHelp
                onClose={shortcuts.close}
                opened={shortcutsOpened}
            />
        </>
    );
}
