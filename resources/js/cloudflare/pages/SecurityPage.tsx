import {
    Alert,
    Badge,
    Button,
    Divider,
    Group,
    Modal,
    Paper,
    Skeleton,
    Stack,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { IconCheck, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Effect } from 'effect';
import { type FormEvent, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { deleteAccount, wipeAccount } from '../api/account';
import {
    deletePasskey,
    getAuthenticationOptions,
    getPasskeyRegistrationOptions,
    type PasskeyRecord,
    readCsrfToken,
    verifyAuthentication,
    verifyPasskeyRegistration,
} from '../api/auth';
import {
    AUTH_TURNSTILE_ACTIONS,
    requestAuthentication,
    requestRegistration,
    supportsPasskeys,
} from '../auth/ceremony';
import { ApplicationPage } from '../components/ApplicationPage';
import { Turnstile, type TurnstileHandle } from '../components/Turnstile';
import {
    accountKeys,
    accountQueryOptions,
    passkeysQueryOptions,
    requireAccountCsrf,
    updateAccountMutationOptions,
} from '../queries/account';
import {
    authConfigQueryOptions,
    clearAuthenticatedCache,
} from '../queries/auth';

const dateTime = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
});

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

function ProfileSection() {
    const queryClient = useQueryClient();
    const profile = useQuery(accountQueryOptions);
    const mutation = useMutation(updateAccountMutationOptions(queryClient));
    const [displayName, setDisplayName] = useState<string | null>(null);
    const [email, setEmail] = useState<string | null>(null);

    const currentDisplayName = displayName ?? profile.data?.displayName ?? '';
    const currentEmail = email ?? profile.data?.email ?? '';
    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        mutation.mutate(
            {
                displayName: currentDisplayName.trim(),
                email: currentEmail.trim(),
            },
            {
                onSuccess: () => {
                    setDisplayName(null);
                    setEmail(null);
                },
            },
        );
    };

    return (
        <Stack component="section" gap="md" id="profile" maw={520}>
            <Stack gap={3}>
                <Title order={2}>Profile settings</Title>
                <Text c="dimmed" size="sm">
                    Update the name and email attached to your private account.
                </Text>
            </Stack>
            {profile.isPending ? (
                <Stack gap="sm">
                    <Skeleton height={62} />
                    <Skeleton height={62} />
                </Stack>
            ) : profile.isError ? (
                <ErrorAlert error={profile.error} title="Profile unavailable" />
            ) : (
                <form onSubmit={submit}>
                    <Stack gap="md" maw={560}>
                        <TextInput
                            label="Username"
                            disabled
                            value={profile.data.username}
                        />
                        <TextInput
                            label="Display name"
                            maxLength={200}
                            onChange={(event) => {
                                setDisplayName(event.currentTarget.value);
                                mutation.reset();
                            }}
                            required
                            value={currentDisplayName}
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
                            value={currentEmail}
                        />
                        <ErrorAlert
                            error={mutation.error}
                            title="Profile was not updated"
                        />
                        {mutation.isSuccess && (
                            <Alert
                                color="green"
                                icon={
                                    <IconCheck aria-hidden="true" size={17} />
                                }
                                role="status"
                            >
                                Profile saved.
                            </Alert>
                        )}
                        <Group justify="flex-end">
                            <Button loading={mutation.isPending} type="submit">
                                Save changes
                            </Button>
                        </Group>
                    </Stack>
                </form>
            )}
        </Stack>
    );
}

function PasskeyItem({
    passkey,
    count,
}: {
    readonly passkey: PasskeyRecord;
    readonly count: number;
}) {
    const queryClient = useQueryClient();
    const [confirm, setConfirm] = useState(false);
    const mutation = useMutation({
        mutationKey: [...accountKeys.passkeys(), passkey.id, 'delete'],
        retry: false,
        mutationFn: () =>
            Effect.runPromise(
                deletePasskey({
                    passkeyId: passkey.id,
                    csrfToken: requireAccountCsrf(),
                }),
            ),
        onSuccess: async () => {
            setConfirm(false);
            await queryClient.invalidateQueries({
                queryKey: accountKeys.passkeys(),
            });
        },
    });
    return (
        <Paper p="md" withBorder>
            <Modal
                centered
                onClose={() => setConfirm(false)}
                opened={confirm}
                title="Delete passkey?"
            >
                <Stack gap="md">
                    <Text size="sm">
                        Delete <strong>{passkey.name}</strong>? You cannot use
                        it to sign in again.
                    </Text>
                    <ErrorAlert
                        error={mutation.error}
                        title="Passkey was not deleted"
                    />
                    <Group justify="flex-end">
                        <Button
                            onClick={() => setConfirm(false)}
                            variant="default"
                        >
                            Cancel
                        </Button>
                        <Button
                            color="red"
                            loading={mutation.isPending}
                            onClick={() => mutation.mutate()}
                        >
                            Delete passkey
                        </Button>
                    </Group>
                </Stack>
            </Modal>
            <Group justify="space-between" align="flex-start" wrap="nowrap">
                <Stack gap={3}>
                    <Group gap="xs">
                        <Text fw={600}>{passkey.name}</Text>
                        {passkey.backedUp && (
                            <Badge color="green" variant="light">
                                Synced
                            </Badge>
                        )}
                    </Group>
                    <Text c="dimmed" size="xs">
                        Added {dateTime.format(new Date(passkey.createdAt))}
                    </Text>
                    <Text c="dimmed" size="xs">
                        {passkey.lastUsedAt === null
                            ? 'Never used'
                            : `Last used ${dateTime.format(new Date(passkey.lastUsedAt))}`}
                    </Text>
                </Stack>
                <Button
                    aria-label={`Delete ${passkey.name}`}
                    color="red"
                    disabled={count <= 1}
                    leftSection={<IconTrash aria-hidden="true" size={15} />}
                    onClick={() => setConfirm(true)}
                    size="xs"
                    variant="light"
                >
                    Delete
                </Button>
            </Group>
            {count <= 1 && (
                <Text c="dimmed" mt="xs" size="xs">
                    Add another passkey before deleting your only sign-in
                    method.
                </Text>
            )}
        </Paper>
    );
}

function PasskeysSection() {
    const config = useQuery(authConfigQueryOptions);
    const passkeys = useQuery(passkeysQueryOptions);
    const queryClient = useQueryClient();
    const turnstile = useRef<TurnstileHandle>(null);
    const [name, setName] = useState('My passkey');
    const mutation = useMutation({
        mutationKey: [...accountKeys.passkeys(), 'create'],
        retry: false,
        mutationFn: async (passkeyName: string) => {
            const csrfToken = requireAccountCsrf();
            const optionsToken = await turnstile.current?.execute(
                AUTH_TURNSTILE_ACTIONS.registrationOptions,
            );
            if (optionsToken === undefined)
                throw new Error('Human verification is unavailable.');
            const options = await Effect.runPromise(
                getPasskeyRegistrationOptions({
                    turnstileToken: optionsToken,
                    csrfToken,
                }),
            );
            const response = await requestRegistration(options.options);
            const verifyToken = await turnstile.current?.execute(
                AUTH_TURNSTILE_ACTIONS.registrationVerify,
            );
            if (verifyToken === undefined)
                throw new Error('Human verification is unavailable.');
            return Effect.runPromise(
                verifyPasskeyRegistration({
                    challengeId: options.challengeId,
                    name: passkeyName,
                    response,
                    turnstileToken: verifyToken,
                    csrfToken,
                }),
            );
        },
        onSuccess: async () =>
            queryClient.invalidateQueries({ queryKey: accountKeys.passkeys() }),
    });
    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const clean = name.trim();
        if (clean.length > 0 && clean.length <= 100) mutation.mutate(clean);
    };

    return (
        <Stack component="section" gap="md" id="security" maw={520}>
            <Stack gap={3}>
                <Title order={2}>Security</Title>
                <Title order={3}>Passkeys</Title>
                <Text c="dimmed" size="sm">
                    Keep at least two passkeys on separate devices for safer
                    recovery.
                </Text>
            </Stack>
            {config.isError && (
                <Alert
                    color="red"
                    role="alert"
                    title="Human verification unavailable"
                >
                    <Stack align="flex-start" gap="xs">
                        <Text size="sm">{config.error.message}</Text>
                        <Button
                            onClick={() => void config.refetch()}
                            size="xs"
                            variant="light"
                        >
                            Retry
                        </Button>
                    </Stack>
                </Alert>
            )}
            {config.data !== undefined && (
                <Turnstile
                    ref={turnstile}
                    siteKey={config.data.turnstileSiteKey}
                />
            )}
            <form onSubmit={submit}>
                <Group align="flex-end" wrap="wrap">
                    <TextInput
                        label="New passkey name"
                        maxLength={100}
                        onChange={(event) => {
                            setName(event.currentTarget.value);
                            mutation.reset();
                        }}
                        required
                        value={name}
                    />
                    <Button
                        disabled={
                            !supportsPasskeys() || config.data === undefined
                        }
                        leftSection={<IconPlus aria-hidden="true" size={16} />}
                        loading={mutation.isPending}
                        type="submit"
                    >
                        Add passkey
                    </Button>
                </Group>
            </form>
            <ErrorAlert
                error={mutation.error}
                title="Passkey could not be added"
            />
            {mutation.isSuccess && (
                <Alert color="green" role="status">
                    Passkey added.
                </Alert>
            )}
            <Divider />
            {passkeys.isPending ? (
                <Skeleton height={90} />
            ) : passkeys.isError ? (
                <ErrorAlert
                    error={passkeys.error}
                    title="Passkeys unavailable"
                />
            ) : (
                <Stack gap="sm">
                    {passkeys.data.passkeys.map((passkey) => (
                        <PasskeyItem
                            count={passkeys.data.passkeys.length}
                            key={passkey.id}
                            passkey={passkey}
                        />
                    ))}
                </Stack>
            )}
        </Stack>
    );
}

function DangerSection({
    userId,
    username,
}: {
    readonly userId: number;
    readonly username: string;
}) {
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const config = useQuery(authConfigQueryOptions);
    const turnstile = useRef<TurnstileHandle>(null);
    const freshAuthentication = async () => {
        const optionsToken = await turnstile.current?.execute(
            AUTH_TURNSTILE_ACTIONS.authenticationOptions,
        );
        if (optionsToken === undefined)
            throw new Error('Human verification is unavailable.');
        const options = await Effect.runPromise(
            getAuthenticationOptions({ turnstileToken: optionsToken }),
        );
        const response = await requestAuthentication(options.options);
        const verifyToken = await turnstile.current?.execute(
            AUTH_TURNSTILE_ACTIONS.authenticationVerify,
        );
        if (verifyToken === undefined)
            throw new Error('Human verification is unavailable.');
        const authenticated = await Effect.runPromise(
            verifyAuthentication({
                challengeId: options.challengeId,
                turnstileToken: verifyToken,
                response,
            }),
        );
        if (authenticated.user.id !== userId)
            throw new Error('Use a passkey for this account.');
    };
    const freshCsrf = () => {
        const csrfToken = readCsrfToken();
        if (csrfToken === undefined)
            throw new Error('The refreshed session security token is missing.');
        return csrfToken;
    };
    const wipe = useMutation({
        mutationKey: [...accountKeys.profile(), 'wipe'],
        retry: false,
        mutationFn: async (input: { readonly confirmation: string }) => {
            await freshAuthentication();
            return Effect.runPromise(
                wipeAccount({ ...input, csrfToken: freshCsrf() }),
            );
        },
        onSuccess: async () =>
            queryClient.invalidateQueries({ queryKey: ['protected'] }),
    });
    const remove = useMutation({
        mutationKey: [...accountKeys.profile(), 'delete'],
        retry: false,
        mutationFn: async (input: { readonly confirmation: string }) => {
            await freshAuthentication();
            return Effect.runPromise(
                deleteAccount({ ...input, csrfToken: freshCsrf() }),
            );
        },
    });
    const [action, setAction] = useState<'wipe' | 'delete' | null>(null);
    const [confirmation, setConfirmation] = useState('');
    const close = () => {
        setAction(null);
        setConfirmation('');
        wipe.reset();
        remove.reset();
    };
    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (action === 'wipe')
            wipe.mutate({ confirmation }, { onSuccess: close });
        if (action === 'delete')
            remove.mutate(
                { confirmation },
                {
                    onSuccess: () => {
                        clearAuthenticatedCache(queryClient);
                        void navigate('/login', { replace: true });
                    },
                },
            );
    };
    const pending = wipe.isPending || remove.isPending;
    const error = wipe.error ?? remove.error;
    return (
        <Stack component="section" gap="md" maw={520}>
            {config.isError && (
                <Alert
                    color="red"
                    role="alert"
                    title="Human verification unavailable"
                >
                    <Stack align="flex-start" gap="xs">
                        <Text size="sm">{config.error.message}</Text>
                        <Button
                            onClick={() => void config.refetch()}
                            size="xs"
                            variant="light"
                        >
                            Retry
                        </Button>
                    </Stack>
                </Alert>
            )}
            {config.data !== undefined && (
                <Turnstile
                    ref={turnstile}
                    siteKey={config.data.turnstileSiteKey}
                />
            )}
            <Modal
                centered
                closeOnClickOutside={!pending}
                onClose={close}
                opened={action !== null}
                title={
                    action === 'delete'
                        ? 'Delete account?'
                        : 'Clear reader data?'
                }
            >
                <form onSubmit={submit}>
                    <Stack gap="md">
                        <Alert color="red">
                            {action === 'delete'
                                ? 'This permanently deletes your account, passkeys, tokens, subscriptions, and private reader state.'
                                : 'This removes your subscriptions, categories, import history, and reader state. Your account and passkeys stay active.'}
                        </Alert>
                        <Text size="sm">
                            Confirm with a passkey, then type your username.
                        </Text>
                        <TextInput
                            autoComplete="off"
                            label={`Type ${username} to confirm`}
                            onChange={(event) =>
                                setConfirmation(event.currentTarget.value)
                            }
                            required
                            value={confirmation}
                        />
                        <ErrorAlert error={error} title="Action failed" />
                        <Group justify="flex-end">
                            <Button
                                disabled={pending}
                                onClick={close}
                                variant="default"
                            >
                                Cancel
                            </Button>
                            <Button
                                color="red"
                                disabled={
                                    confirmation !== username ||
                                    config.data === undefined
                                }
                                loading={pending}
                                type="submit"
                            >
                                Confirm with passkey
                            </Button>
                        </Group>
                    </Stack>
                </form>
            </Modal>
            <Stack gap="md">
                <Stack gap={3}>
                    <Title c="red" order={2} size="h3">
                        Danger zone
                    </Title>
                    <Text c="dimmed" size="sm">
                        Destructive actions require a fresh passkey check and
                        your exact username.
                    </Text>
                </Stack>
                <Group justify="space-between" wrap="wrap">
                    <Stack gap={2}>
                        <Text fw={600}>Clear reader data</Text>
                        <Text c="dimmed" size="sm">
                            Keep your account but remove subscriptions and
                            private reader state.
                        </Text>
                    </Stack>
                    <Button
                        color="red"
                        onClick={() => setAction('wipe')}
                        variant="light"
                    >
                        Clear data
                    </Button>
                </Group>
                <Divider />
                <Group justify="space-between" wrap="wrap">
                    <Stack gap={2}>
                        <Text fw={600}>Delete account</Text>
                        <Text c="dimmed" size="sm">
                            Permanently remove this Larafeed account.
                        </Text>
                    </Stack>
                    <Button
                        color="red"
                        leftSection={<IconTrash aria-hidden="true" size={16} />}
                        onClick={() => setAction('delete')}
                    >
                        Delete account
                    </Button>
                </Group>
            </Stack>
        </Stack>
    );
}

export function SecurityPage() {
    const profile = useQuery(accountQueryOptions);
    const location = useLocation();
    const section = location.hash === '#security' ? 'security' : 'profile';

    return (
        <ApplicationPage activePage="settings" settingsNavigation>
            <Stack gap="xl" maw={720} mx="auto" my="md">
                <Stack gap={4}>
                    <Title order={1}>Settings</Title>
                    <Text c="dimmed" size="sm">
                        Manage your account, preferences, and data import/export
                        tools.
                    </Text>
                </Stack>
                {section === 'security' ? (
                    <PasskeysSection />
                ) : (
                    <>
                        <ProfileSection />
                        {profile.data !== undefined && (
                            <DangerSection
                                userId={profile.data.id}
                                username={profile.data.username}
                            />
                        )}
                    </>
                )}
            </Stack>
        </ApplicationPage>
    );
}
