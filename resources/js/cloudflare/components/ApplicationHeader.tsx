import {
    ActionIcon,
    AppShell,
    Avatar,
    Burger,
    Group,
    Menu,
    rem,
    Title,
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
import { useMemo } from 'react';
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
                            `/feeds?feed=${subscription.feedId}&filter=all&order_by=published_at&page=1`,
                        ),
                };
            }),
        [navigate, subscriptions.data?.subscriptions],
    );

    return (
        <>
            {spotlightActions.length > 0 && (
                <Spotlight
                    actions={spotlightActions}
                    highlightQuery
                    maxHeight="calc(100vh * 0.6)"
                    nothingFound="Nothing found..."
                    scrollable
                    searchProps={{
                        leftSection: (
                            <IconSearch
                                style={{ width: rem(20), height: rem(20) }}
                                stroke={1.5}
                            />
                        ),
                        placeholder: 'Search feeds...',
                    }}
                    shortcut="mod + K"
                />
            )}
            <AppShell.Header>
                <Group h="100%" px="md" justify="space-between" wrap="nowrap">
                    <Group gap="sm" wrap="nowrap">
                        {hasSidebar && (
                            <Burger
                                aria-label="Toggle navigation"
                                hiddenFrom="sm"
                                onClick={onNavbarToggle}
                                opened={navbarOpened}
                                size="sm"
                            />
                        )}
                        <Link className={classes.logoLink} to="/feeds">
                            <Group gap="xs">
                                <ApplicationLogo width={36} />
                                <Title
                                    className={classes.brandTitle}
                                    order={3}
                                    style={{ margin: 0 }}
                                >
                                    Larafeed
                                </Title>
                            </Group>
                        </Link>

                        <Group gap={4} wrap="nowrap">
                            {navigation.map((item) => {
                                const Icon = item.icon;
                                return (
                                    <Tooltip
                                        key={item.key}
                                        label={item.label}
                                        openDelay={400}
                                        withArrow
                                    >
                                        <ActionIcon
                                            aria-label={`${item.label} page`}
                                            component={Link}
                                            size="lg"
                                            to={item.to}
                                            variant={
                                                item.key === activePage
                                                    ? 'filled'
                                                    : 'subtle'
                                            }
                                        >
                                            <Icon size={18} stroke={1.6} />
                                        </ActionIcon>
                                    </Tooltip>
                                );
                            })}
                        </Group>
                    </Group>

                    <Group
                        className={classes.headerActions}
                        gap="sm"
                        wrap="nowrap"
                    >
                        <ActionIcon
                            aria-label="Open Larafeed GitHub repository"
                            className={classes.githubButton}
                            component="a"
                            href="https://github.com/angristan/larafeed"
                            rel="noopener noreferrer"
                            size="lg"
                            target="_blank"
                            variant="default"
                        >
                            <IconBrandGithub size={20} stroke={1.5} />
                        </ActionIcon>

                        <ActionIcon
                            aria-label="Keyboard shortcuts"
                            className={classes.keyboardButton}
                            mt={1}
                            onClick={shortcuts.open}
                            size="lg"
                            variant="default"
                        >
                            <IconKeyboard stroke={1.5} size={20} />
                        </ActionIcon>

                        <ActionIcon
                            aria-label="Toggle color scheme"
                            mt={1}
                            onClick={toggleColorScheme}
                            size="lg"
                            variant="default"
                        >
                            {computedColorScheme === 'light' ? (
                                <IconSun stroke={1.5} size={20} />
                            ) : (
                                <IconMoon stroke={1.5} size={20} />
                            )}
                        </ActionIcon>

                        {user !== undefined && (
                            <Menu
                                closeDelay={300}
                                position="top-end"
                                shadow="md"
                                trigger="click-hover"
                                width={220}
                            >
                                <Menu.Target>
                                    <Avatar
                                        aria-label={`Signed in as ${user.displayName}`}
                                        className={classes.user}
                                        radius="xl"
                                    >
                                        {user.displayName[0]}
                                    </Avatar>
                                </Menu.Target>
                                <Menu.Dropdown>
                                    <Menu.Label>
                                        {profile.data?.email ??
                                            `@${user.username}`}
                                    </Menu.Label>
                                    {user.isAdmin && (
                                        <Menu.Item
                                            component={Link}
                                            leftSection={
                                                <IconSettings size={14} />
                                            }
                                            to="/admin/users"
                                        >
                                            Administration
                                        </Menu.Item>
                                    )}
                                    <Menu.Divider />
                                    <Menu.Item
                                        disabled={logoutMutation.isPending}
                                        leftSection={
                                            <IconLogout
                                                style={{
                                                    width: rem(14),
                                                    height: rem(14),
                                                }}
                                            />
                                        }
                                        onClick={() => logoutMutation.mutate()}
                                    >
                                        Logout
                                    </Menu.Item>
                                </Menu.Dropdown>
                            </Menu>
                        )}
                    </Group>
                </Group>
            </AppShell.Header>
            <ReaderShortcutHelp
                onClose={shortcuts.close}
                opened={shortcutsOpened}
            />
        </>
    );
}
