import {
    Alert,
    Badge,
    Button,
    Checkbox,
    Container,
    Group,
    Paper,
    Skeleton,
    Stack,
    Table,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import {
    IconCheck,
    IconCopy,
    IconLink,
    IconRefresh,
    IconShieldLock,
    IconUserPlus,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';

import type { ManagedAccessLink, ManagedUser } from '../api/account';
import { ApplicationPage } from '../components/ApplicationPage';
import {
    adminOverviewQueryOptions,
    createEnrollmentLinkMutationOptions,
    createRecoveryLinkMutationOptions,
    revokeAccessLinkMutationOptions,
    setUserDisabledMutationOptions,
} from '../queries/account';

const dateTime = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
});
const eventLabels: Record<string, string> = {
    'authentication.succeeded': 'Signed in',
    'passkey.registered': 'Passkey added',
    'passkey.deleted': 'Passkey deleted',
    'recovery.completed': 'Recovery completed',
    'session.revoked': 'Signed out',
    'access.enrollment_created': 'Enrollment link created',
    'access.recovery_created': 'Recovery link created',
    'access.revoked': 'Access link revoked',
    'app_token.created': 'Reader app token created',
    'app_token.revoked': 'Reader app token revoked',
    'account.profile.updated': 'Profile updated',
    'account.reader.wiped': 'Reader data cleared',
    'account.deleted': 'Account deleted',
    'account.disabled': 'Account disabled',
    'account.reactivated': 'Account reactivated',
};

function ErrorAlert({
    error,
    title,
}: {
    readonly error: Error | null;
    readonly title: string;
}) {
    return error === null ? null : (
        <Alert color="red" role="alert" title={title}>
            {error.message}
        </Alert>
    );
}
function linkStatus(
    link: ManagedAccessLink,
    now = Date.now(),
): { label: string; color: string; active: boolean } {
    if (link.consumedAt !== null)
        return { label: 'Used', color: 'green', active: false };
    if (link.revokedAt !== null)
        return { label: 'Revoked', color: 'gray', active: false };
    if (link.expiresAt <= now)
        return { label: 'Expired', color: 'orange', active: false };
    return { label: 'Active', color: 'blue', active: true };
}

function EnrollmentForm() {
    const queryClient = useQueryClient();
    const mutation = useMutation(
        createEnrollmentLinkMutationOptions(queryClient),
    );
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [isAdmin, setIsAdmin] = useState(false);
    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        mutation.mutate({
            username: username.trim(),
            email: email.trim(),
            displayName: displayName.trim(),
            isAdmin,
        });
    };
    const copy = async () => {
        if (mutation.data !== undefined)
            await navigator.clipboard.writeText(mutation.data.url);
    };
    return (
        <Paper component="section" withBorder p={{ base: 'lg', sm: 'xl' }}>
            <form onSubmit={submit}>
                <Stack gap="md">
                    <Stack gap={3}>
                        <Title order={2} size="h3">
                            Invite a user
                        </Title>
                        <Text c="dimmed" size="sm">
                            Create a short-lived, one-time passkey enrollment
                            link. Send it through a trusted channel.
                        </Text>
                    </Stack>
                    <Group grow align="flex-start" wrap="wrap">
                        <TextInput
                            label="Username"
                            maxLength={100}
                            onChange={(event) => {
                                setUsername(event.currentTarget.value);
                                mutation.reset();
                            }}
                            required
                            value={username}
                        />
                        <TextInput
                            label="Display name"
                            maxLength={200}
                            onChange={(event) => {
                                setDisplayName(event.currentTarget.value);
                                mutation.reset();
                            }}
                            required
                            value={displayName}
                        />
                        <TextInput
                            label="Email"
                            maxLength={320}
                            onChange={(event) => {
                                setEmail(event.currentTarget.value);
                                mutation.reset();
                            }}
                            required
                            type="email"
                            value={email}
                        />
                    </Group>
                    <Checkbox
                        checked={isAdmin}
                        label="Administrator account"
                        onChange={(event) => {
                            setIsAdmin(event.currentTarget.checked);
                            mutation.reset();
                        }}
                    />
                    <ErrorAlert
                        error={mutation.error}
                        title="Enrollment link was not created"
                    />
                    {mutation.data !== undefined && (
                        <Alert
                            color="green"
                            icon={<IconLink aria-hidden="true" size={18} />}
                            title="Copy this link now"
                        >
                            <Stack gap="xs">
                                <Text className="break-anywhere" size="sm">
                                    {mutation.data.url}
                                </Text>
                                <Group>
                                    <Button
                                        leftSection={
                                            <IconCopy
                                                aria-hidden="true"
                                                size={15}
                                            />
                                        }
                                        onClick={() => void copy()}
                                        size="xs"
                                        variant="light"
                                    >
                                        Copy link
                                    </Button>
                                    <Text c="dimmed" size="xs">
                                        Expires{' '}
                                        {dateTime.format(
                                            new Date(mutation.data.expiresAt),
                                        )}
                                    </Text>
                                </Group>
                            </Stack>
                        </Alert>
                    )}
                    <Group justify="flex-end">
                        <Button
                            leftSection={
                                <IconUserPlus aria-hidden="true" size={16} />
                            }
                            loading={mutation.isPending}
                            type="submit"
                        >
                            Create enrollment link
                        </Button>
                    </Group>
                </Stack>
            </form>
        </Paper>
    );
}

function UserRow({
    user,
    currentUserId,
}: {
    readonly user: ManagedUser;
    readonly currentUserId: number;
}) {
    const queryClient = useQueryClient();
    const stateMutation = useMutation(
        setUserDisabledMutationOptions(queryClient),
    );
    const recovery = useMutation(
        createRecoveryLinkMutationOptions(queryClient),
    );
    const copyRecovery = async () => {
        if (recovery.data !== undefined)
            await navigator.clipboard.writeText(recovery.data.url);
    };
    return (
        <Table.Tr>
            <Table.Td>
                <Stack gap={1}>
                    <Group gap="xs">
                        <Text fw={600}>{user.displayName}</Text>
                        {user.isAdmin && <Badge variant="light">Admin</Badge>}
                        {user.disabledAt !== null && (
                            <Badge color="red" variant="light">
                                Disabled
                            </Badge>
                        )}
                    </Group>
                    <Text c="dimmed" size="xs">
                        @{user.username} · {user.email}
                    </Text>
                    {recovery.data !== undefined && (
                        <Alert color="green" mt="xs" p="xs">
                            <Stack gap={4}>
                                <Text className="break-anywhere" size="xs">
                                    {recovery.data.url}
                                </Text>
                                <Button
                                    leftSection={
                                        <IconCopy
                                            aria-hidden="true"
                                            size={13}
                                        />
                                    }
                                    onClick={() => void copyRecovery()}
                                    size="compact-xs"
                                    variant="subtle"
                                >
                                    Copy recovery link
                                </Button>
                            </Stack>
                        </Alert>
                    )}
                    <ErrorAlert
                        error={recovery.error ?? stateMutation.error}
                        title="User action failed"
                    />
                </Stack>
            </Table.Td>
            <Table.Td ta="right">{user.passkeyCount}</Table.Td>
            <Table.Td ta="right">{user.subscriptionCount}</Table.Td>
            <Table.Td>
                <Group gap="xs" justify="flex-end" wrap="nowrap">
                    <Button
                        loading={recovery.isPending}
                        onClick={() => recovery.mutate({ userId: user.id })}
                        size="xs"
                        variant="light"
                    >
                        Recovery link
                    </Button>
                    <Button
                        color={user.disabledAt === null ? 'red' : 'green'}
                        disabled={user.id === currentUserId}
                        loading={stateMutation.isPending}
                        onClick={() =>
                            stateMutation.mutate({
                                userId: user.id,
                                disabled: user.disabledAt === null,
                            })
                        }
                        size="xs"
                        variant="light"
                    >
                        {user.disabledAt === null ? 'Disable' : 'Reactivate'}
                    </Button>
                </Group>
            </Table.Td>
        </Table.Tr>
    );
}

export function AdminUsersPage() {
    const overview = useQuery(adminOverviewQueryOptions);
    const queryClient = useQueryClient();
    const revoke = useMutation(revokeAccessLinkMutationOptions(queryClient));
    const [session] = useState(() =>
        queryClient.getQueryData<{
            authenticated: boolean;
            user?: { id: number };
        }>(['auth', 'session']),
    );
    const currentUserId = session?.user?.id ?? -1;
    return (
        <ApplicationPage activePage="settings" settingsNavigation>
            <Container component="div" size="xl" py="md">
                <Stack gap="xl">
                    <Stack gap="xs" align="flex-start">
                        <Group gap="sm">
                            <IconShieldLock aria-hidden="true" size={30} />
                            <Title order={1}>Administration</Title>
                        </Group>
                        <Text c="dimmed">
                            Invite users, issue recovery links, control access,
                            and review security events.
                        </Text>
                    </Stack>
                    <EnrollmentForm />
                    {overview.isPending ? (
                        <Stack gap="md">
                            <Skeleton height={240} />
                            <Skeleton height={180} />
                        </Stack>
                    ) : overview.isError ? (
                        <Alert
                            color="red"
                            role="alert"
                            title="Administration unavailable"
                        >
                            <Stack align="flex-start" gap="sm">
                                <Text size="sm">{overview.error.message}</Text>
                                <Button
                                    leftSection={
                                        <IconRefresh
                                            aria-hidden="true"
                                            size={15}
                                        />
                                    }
                                    onClick={() => void overview.refetch()}
                                    size="xs"
                                    variant="light"
                                >
                                    Retry
                                </Button>
                            </Stack>
                        </Alert>
                    ) : (
                        <>
                            <Paper
                                component="section"
                                withBorder
                                p={{ base: 'lg', sm: 'xl' }}
                            >
                                <Stack gap="md">
                                    <Stack gap={3}>
                                        <Title order={2} size="h3">
                                            Users
                                        </Title>
                                        <Text c="dimmed" size="sm">
                                            Disabling an account revokes its
                                            sessions and outstanding links. The
                                            final active administrator is
                                            protected.
                                        </Text>
                                    </Stack>
                                    <Table.ScrollContainer minWidth={820}>
                                        <Table striped withRowBorders={false}>
                                            <Table.Thead>
                                                <Table.Tr>
                                                    <Table.Th>User</Table.Th>
                                                    <Table.Th ta="right">
                                                        Passkeys
                                                    </Table.Th>
                                                    <Table.Th ta="right">
                                                        Feeds
                                                    </Table.Th>
                                                    <Table.Th ta="right">
                                                        Actions
                                                    </Table.Th>
                                                </Table.Tr>
                                            </Table.Thead>
                                            <Table.Tbody>
                                                {overview.data.users.map(
                                                    (user) => (
                                                        <UserRow
                                                            currentUserId={
                                                                currentUserId
                                                            }
                                                            key={user.id}
                                                            user={user}
                                                        />
                                                    ),
                                                )}
                                            </Table.Tbody>
                                        </Table>
                                    </Table.ScrollContainer>
                                </Stack>
                            </Paper>
                            <Paper
                                component="section"
                                withBorder
                                p={{ base: 'lg', sm: 'xl' }}
                            >
                                <Stack gap="md">
                                    <Stack gap={3}>
                                        <Title order={2} size="h3">
                                            Access links
                                        </Title>
                                        <Text c="dimmed" size="sm">
                                            Recent enrollment and recovery link
                                            metadata. Secret link tokens are
                                            only shown once when created.
                                        </Text>
                                    </Stack>
                                    <ErrorAlert
                                        error={revoke.error}
                                        title="Link was not revoked"
                                    />
                                    <Table.ScrollContainer minWidth={700}>
                                        <Table striped withRowBorders={false}>
                                            <Table.Thead>
                                                <Table.Tr>
                                                    <Table.Th>User</Table.Th>
                                                    <Table.Th>Purpose</Table.Th>
                                                    <Table.Th>Status</Table.Th>
                                                    <Table.Th>Expires</Table.Th>
                                                    <Table.Th />
                                                </Table.Tr>
                                            </Table.Thead>
                                            <Table.Tbody>
                                                {overview.data.accessLinks
                                                    .length === 0 ? (
                                                    <Table.Tr>
                                                        <Table.Td colSpan={5}>
                                                            <Text
                                                                c="dimmed"
                                                                size="sm"
                                                            >
                                                                No access links
                                                                yet.
                                                            </Text>
                                                        </Table.Td>
                                                    </Table.Tr>
                                                ) : (
                                                    overview.data.accessLinks.map(
                                                        (link) => {
                                                            const status =
                                                                linkStatus(
                                                                    link,
                                                                );
                                                            return (
                                                                <Table.Tr
                                                                    key={
                                                                        link.id
                                                                    }
                                                                >
                                                                    <Table.Td>
                                                                        @
                                                                        {
                                                                            link.username
                                                                        }
                                                                    </Table.Td>
                                                                    <Table.Td>
                                                                        {
                                                                            link.purpose
                                                                        }
                                                                    </Table.Td>
                                                                    <Table.Td>
                                                                        <Badge
                                                                            color={
                                                                                status.color
                                                                            }
                                                                            variant="light"
                                                                        >
                                                                            {
                                                                                status.label
                                                                            }
                                                                        </Badge>
                                                                    </Table.Td>
                                                                    <Table.Td>
                                                                        {dateTime.format(
                                                                            new Date(
                                                                                link.expiresAt,
                                                                            ),
                                                                        )}
                                                                    </Table.Td>
                                                                    <Table.Td ta="right">
                                                                        {status.active && (
                                                                            <Button
                                                                                color="red"
                                                                                loading={
                                                                                    revoke.isPending &&
                                                                                    revoke
                                                                                        .variables
                                                                                        ?.linkId ===
                                                                                        link.id
                                                                                }
                                                                                onClick={() =>
                                                                                    revoke.mutate(
                                                                                        {
                                                                                            linkId: link.id,
                                                                                        },
                                                                                    )
                                                                                }
                                                                                size="xs"
                                                                                variant="subtle"
                                                                            >
                                                                                Revoke
                                                                            </Button>
                                                                        )}
                                                                    </Table.Td>
                                                                </Table.Tr>
                                                            );
                                                        },
                                                    )
                                                )}
                                            </Table.Tbody>
                                        </Table>
                                    </Table.ScrollContainer>
                                </Stack>
                            </Paper>
                            <Paper
                                component="section"
                                withBorder
                                p={{ base: 'lg', sm: 'xl' }}
                            >
                                <Stack gap="md">
                                    <Stack gap={3}>
                                        <Title order={2} size="h3">
                                            Recent security events
                                        </Title>
                                        <Text c="dimmed" size="sm">
                                            The latest account and
                                            authentication events stored in D1.
                                        </Text>
                                    </Stack>
                                    <Table.ScrollContainer minWidth={620}>
                                        <Table striped withRowBorders={false}>
                                            <Table.Thead>
                                                <Table.Tr>
                                                    <Table.Th>Time</Table.Th>
                                                    <Table.Th>Event</Table.Th>
                                                    <Table.Th>User ID</Table.Th>
                                                    <Table.Th>
                                                        Actor ID
                                                    </Table.Th>
                                                </Table.Tr>
                                            </Table.Thead>
                                            <Table.Tbody>
                                                {overview.data.securityEvents.map(
                                                    (event) => (
                                                        <Table.Tr
                                                            key={event.id}
                                                        >
                                                            <Table.Td>
                                                                {dateTime.format(
                                                                    new Date(
                                                                        event.createdAt,
                                                                    ),
                                                                )}
                                                            </Table.Td>
                                                            <Table.Td>
                                                                {eventLabels[
                                                                    event.kind
                                                                ] ?? event.kind}
                                                            </Table.Td>
                                                            <Table.Td>
                                                                {event.userId ??
                                                                    '—'}
                                                            </Table.Td>
                                                            <Table.Td>
                                                                {event.actorUserId ??
                                                                    '—'}
                                                            </Table.Td>
                                                        </Table.Tr>
                                                    ),
                                                )}
                                            </Table.Tbody>
                                        </Table>
                                    </Table.ScrollContainer>
                                </Stack>
                            </Paper>
                        </>
                    )}
                    <Group>
                        <Badge
                            color="green"
                            leftSection={
                                <IconCheck aria-hidden="true" size={12} />
                            }
                            variant="light"
                        >
                            Passkey-only access
                        </Badge>
                        <Button
                            component={Link}
                            size="xs"
                            to="/settings/security"
                            variant="subtle"
                        >
                            My security settings
                        </Button>
                    </Group>
                </Stack>
            </Container>
        </ApplicationPage>
    );
}
