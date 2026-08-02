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
import {
    IconBook2,
    IconBrandGithub,
    IconChartBar,
    IconCheck,
    IconDeviceDesktop,
    IconKeyboard,
    IconList,
    IconLogout,
    IconMoon,
    IconSettings,
    IconSun,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Effect } from 'effect';
import { Link, useNavigate } from 'react-router';

import { AuthClientError, logout, readCsrfToken } from '../api/auth';
import {
    authKeys,
    authSessionQueryOptions,
    clearAuthenticatedCache,
    isUnauthenticatedError,
} from '../queries/auth';
import classes from './ApplicationHeader.module.css';
import ApplicationLogo from './ApplicationLogo';
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
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const [shortcutsOpened, shortcuts] = useDisclosure(false);
    const { colorScheme, setColorScheme } = useMantineColorScheme();
    const computedColorScheme = useComputedColorScheme('light');

    useHotkeys([
        ['shift+?', shortcuts.toggle],
        [
            'mod+j',
            () =>
                setColorScheme(
                    computedColorScheme === 'light' ? 'dark' : 'light',
                ),
        ],
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
    const ThemeIcon =
        colorScheme === 'auto'
            ? IconDeviceDesktop
            : computedColorScheme === 'dark'
              ? IconMoon
              : IconSun;

    return (
        <>
            <AppShell.Header>
                <Group h="100%" px="md" justify="space-between" wrap="nowrap">
                    <Group
                        className={classes.headerGroup}
                        gap="sm"
                        wrap="nowrap"
                    >
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
                            <Group gap="xs" wrap="nowrap">
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

                    <Group gap="sm" wrap="nowrap">
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

                        <Tooltip label="Keyboard shortcuts" withArrow>
                            <ActionIcon
                                aria-label="Keyboard shortcuts"
                                onClick={shortcuts.open}
                                size="lg"
                                variant="default"
                            >
                                <IconKeyboard
                                    aria-hidden="true"
                                    size={20}
                                    stroke={1.5}
                                />
                            </ActionIcon>
                        </Tooltip>

                        <Menu position="bottom-end" shadow="md" width={180}>
                            <Menu.Target>
                                <ActionIcon
                                    aria-label="Color scheme"
                                    size="lg"
                                    variant="default"
                                >
                                    <ThemeIcon
                                        className={classes.themeIcon}
                                        stroke={1.5}
                                    />
                                </ActionIcon>
                            </Menu.Target>
                            <Menu.Dropdown>
                                <Menu.Label>Color scheme</Menu.Label>
                                {[
                                    {
                                        value: 'auto' as const,
                                        label: 'System',
                                        icon: IconDeviceDesktop,
                                    },
                                    {
                                        value: 'light' as const,
                                        label: 'Light',
                                        icon: IconSun,
                                    },
                                    {
                                        value: 'dark' as const,
                                        label: 'Dark',
                                        icon: IconMoon,
                                    },
                                ].map((option) => {
                                    const Icon = option.icon;
                                    return (
                                        <Menu.Item
                                            key={option.value}
                                            leftSection={
                                                <Icon
                                                    style={{
                                                        width: rem(14),
                                                        height: rem(14),
                                                    }}
                                                />
                                            }
                                            onClick={() =>
                                                setColorScheme(option.value)
                                            }
                                            rightSection={
                                                colorScheme === option.value ? (
                                                    <IconCheck size={14} />
                                                ) : null
                                            }
                                        >
                                            {option.label}
                                        </Menu.Item>
                                    );
                                })}
                            </Menu.Dropdown>
                        </Menu>

                        {user !== undefined && (
                            <Menu
                                position="bottom-end"
                                shadow="md"
                                trigger="click-hover"
                                width={220}
                            >
                                <Menu.Target>
                                    <Avatar
                                        aria-label={`Signed in as ${user.displayName}`}
                                        className={classes.user}
                                        name={user.displayName}
                                        radius="xl"
                                        size="md"
                                    />
                                </Menu.Target>
                                <Menu.Dropdown>
                                    <Menu.Label>@{user.username}</Menu.Label>
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
                                        color="red"
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
