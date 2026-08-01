import {
    Alert,
    Badge,
    Button,
    Checkbox,
    Code,
    Container,
    CopyButton,
    Group,
    Loader,
    Modal,
    Paper,
    Stack,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import type { AppTokenScope } from '@shared/schemas/auth';
import {
    IconAlertTriangle,
    IconArrowLeft,
    IconCheck,
    IconCopy,
    IconInfoCircle,
    IconKey,
    IconRefresh,
    IconTrash,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router';

import type { AppToken, CreatedAppToken } from '../api/appTokens';
import {
    appTokenListQueryOptions,
    createAppTokenMutationOptions,
    revokeAppTokenMutationOptions,
} from '../queries/appTokens';

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
});

const scopePresentation = {
    'google-reader': {
        label: 'Google Reader',
        description: 'Use this token with Google Reader-compatible clients.',
    },
    fever: {
        label: 'Fever',
        description: 'Use this token with Fever-compatible clients.',
    },
} as const satisfies Record<
    AppTokenScope,
    { readonly label: string; readonly description: string }
>;

function isAppTokenScope(value: string): value is AppTokenScope {
    return value === 'google-reader' || value === 'fever';
}

function formatTimestamp(timestamp: number): string {
    return dateTimeFormatter.format(new Date(timestamp));
}

function AppTokenCard({
    token,
    onRevoke,
}: {
    readonly token: AppToken;
    readonly onRevoke: (token: AppToken) => void;
}) {
    const headingId = `app-token-${token.id}`;

    return (
        <Paper
            component="li"
            aria-labelledby={headingId}
            withBorder
            p={{ base: 'md', sm: 'lg' }}
            style={{ listStyle: 'none' }}
        >
            <Stack gap="md">
                <Group justify="space-between" align="flex-start" wrap="wrap">
                    <Stack gap={3}>
                        <Title id={headingId} order={3} size="h4">
                            {token.name}
                        </Title>
                        <Text c="dimmed" size="sm">
                            Token prefix <Code>{token.prefix}…</Code>
                        </Text>
                    </Stack>
                    <Button
                        color="red"
                        leftSection={<IconTrash aria-hidden="true" size={16} />}
                        onClick={() => onRevoke(token)}
                        size="xs"
                        variant="light"
                    >
                        Revoke
                    </Button>
                </Group>

                <Group gap="xs" aria-label="Allowed APIs">
                    {token.scopes.map((scope) => (
                        <Badge key={scope} variant="light">
                            {scopePresentation[scope].label}
                        </Badge>
                    ))}
                </Group>

                <Group gap="xl" align="flex-start" wrap="wrap">
                    <Stack gap={0}>
                        <Text c="dimmed" size="xs">
                            Created
                        </Text>
                        <Text size="sm">
                            {formatTimestamp(token.createdAt)}
                        </Text>
                    </Stack>
                    <Stack gap={0}>
                        <Text c="dimmed" size="xs">
                            Last used
                        </Text>
                        <Text size="sm">
                            {token.lastUsedAt === null
                                ? 'Never'
                                : formatTimestamp(token.lastUsedAt)}
                        </Text>
                    </Stack>
                    <Stack gap={0}>
                        <Text c="dimmed" size="xs">
                            Expires
                        </Text>
                        <Text size="sm">
                            {token.expiresAt === null
                                ? 'Never'
                                : formatTimestamp(token.expiresAt)}
                        </Text>
                    </Stack>
                </Group>
            </Stack>
        </Paper>
    );
}

function AppTokenList({
    tokens,
    onRevoke,
}: {
    readonly tokens: readonly AppToken[];
    readonly onRevoke: (token: AppToken) => void;
}) {
    if (tokens.length === 0) {
        return (
            <Paper withBorder p="xl">
                <Stack align="center" gap="xs" ta="center">
                    <IconInfoCircle aria-hidden="true" size={28} />
                    <Text fw={600}>No app tokens</Text>
                    <Text c="dimmed" maw={500} size="sm">
                        Create a token when you connect a Google Reader or Fever
                        client.
                    </Text>
                </Stack>
            </Paper>
        );
    }

    return (
        <Stack component="ul" gap="sm" m={0} p={0}>
            {tokens.map((token) => (
                <AppTokenCard
                    key={token.id}
                    token={token}
                    onRevoke={onRevoke}
                />
            ))}
        </Stack>
    );
}

export function AppTokensPage() {
    const queryClient = useQueryClient();
    const tokensQuery = useQuery(appTokenListQueryOptions);
    const [name, setName] = useState('');
    const [nameTouched, setNameTouched] = useState(false);
    const [scopes, setScopes] = useState<readonly AppTokenScope[]>([]);
    const [scopesTouched, setScopesTouched] = useState(false);
    const [plaintextToken, setPlaintextToken] = useState<string | null>(null);
    const [tokenToRevoke, setTokenToRevoke] = useState<AppToken | null>(null);

    const revealCreatedToken = useCallback((created: CreatedAppToken) => {
        setPlaintextToken(created.plaintextToken);
    }, []);
    const createMutation = useMutation(
        createAppTokenMutationOptions(queryClient, revealCreatedToken),
    );
    const revokeMutation = useMutation(
        revokeAppTokenMutationOptions(queryClient, tokenToRevoke?.id ?? 0),
    );

    const normalizedName = name.trim();
    const nameError =
        normalizedName.length === 0
            ? 'Enter a name for this token.'
            : normalizedName.length > 100
              ? 'Use 100 characters or fewer.'
              : undefined;
    const scopesError =
        scopes.length === 0 ? 'Select at least one API.' : undefined;

    const sortedTokens = useMemo(
        () =>
            [...(tokensQuery.data?.tokens ?? [])].sort(
                (left, right) => right.createdAt - left.createdAt,
            ),
        [tokensQuery.data?.tokens],
    );

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setNameTouched(true);
        setScopesTouched(true);

        if (nameError !== undefined || scopesError !== undefined) {
            return;
        }

        setPlaintextToken(null);
        createMutation.mutate(
            { name: normalizedName, scopes },
            {
                onSuccess: () => {
                    setName('');
                    setNameTouched(false);
                    setScopes([]);
                    setScopesTouched(false);
                },
            },
        );
    };

    const handleScopeChange = (values: string[]) => {
        setScopes(values.filter(isAppTokenScope));
        setScopesTouched(true);
        createMutation.reset();
    };

    const openRevokeConfirmation = (token: AppToken) => {
        revokeMutation.reset();
        setTokenToRevoke(token);
    };

    const closeRevokeConfirmation = () => {
        if (!revokeMutation.isPending) {
            setTokenToRevoke(null);
            revokeMutation.reset();
        }
    };

    const confirmRevoke = () => {
        if (tokenToRevoke === null) {
            return;
        }

        revokeMutation.mutate(undefined, {
            onSuccess: () => setTokenToRevoke(null),
        });
    };

    return (
        <Container component="main" size="md" py={{ base: 'lg', sm: 'xl' }}>
            <Modal
                centered
                closeOnClickOutside={!revokeMutation.isPending}
                closeOnEscape={!revokeMutation.isPending}
                onClose={closeRevokeConfirmation}
                opened={tokenToRevoke !== null}
                title="Revoke app token?"
            >
                <Stack gap="md">
                    <Text size="sm">
                        {tokenToRevoke === null ? (
                            'This client will lose access immediately.'
                        ) : (
                            <>
                                <strong>{tokenToRevoke.name}</strong> will stop
                                working immediately. This action cannot be
                                undone.
                            </>
                        )}
                    </Text>

                    {revokeMutation.isError && (
                        <Alert
                            color="red"
                            title="Token was not revoked"
                            role="alert"
                        >
                            {revokeMutation.error.message}
                        </Alert>
                    )}

                    <Group justify="flex-end">
                        <Button
                            disabled={revokeMutation.isPending}
                            onClick={closeRevokeConfirmation}
                            variant="default"
                        >
                            Cancel
                        </Button>
                        <Button
                            color="red"
                            leftSection={
                                <IconTrash aria-hidden="true" size={16} />
                            }
                            loading={revokeMutation.isPending}
                            onClick={confirmRevoke}
                        >
                            Revoke token
                        </Button>
                    </Group>
                </Stack>
            </Modal>

            <Stack gap="xl">
                <Stack gap={4}>
                    <Button
                        component={Link}
                        leftSection={
                            <IconArrowLeft aria-hidden="true" size={16} />
                        }
                        size="compact-sm"
                        to="/feeds"
                        variant="subtle"
                    >
                        Back to reader
                    </Button>
                    <Title order={1}>App tokens</Title>
                    <Text c="dimmed" maw={640}>
                        Give compatible feed reader apps limited, revocable
                        access without sharing your passkey.
                    </Text>
                </Stack>

                {plaintextToken !== null && (
                    <Alert
                        color="orange"
                        icon={
                            <IconAlertTriangle aria-hidden="true" size={20} />
                        }
                        title="Copy this token now"
                        role="status"
                    >
                        <Stack gap="sm">
                            <Text size="sm">
                                This is the only time Larafeed will show the
                                token. It cannot be recovered after you dismiss
                                this message or leave this page.
                            </Text>
                            <Code
                                block
                                aria-label="New app token"
                                style={{
                                    overflowWrap: 'anywhere',
                                    whiteSpace: 'pre-wrap',
                                }}
                            >
                                {plaintextToken}
                            </Code>
                            <Group gap="sm">
                                <CopyButton value={plaintextToken}>
                                    {({ copied, copy }) => (
                                        <Button
                                            color={copied ? 'teal' : 'blue'}
                                            leftSection={
                                                copied ? (
                                                    <IconCheck
                                                        aria-hidden="true"
                                                        size={16}
                                                    />
                                                ) : (
                                                    <IconCopy
                                                        aria-hidden="true"
                                                        size={16}
                                                    />
                                                )
                                            }
                                            onClick={copy}
                                            size="xs"
                                            variant="light"
                                        >
                                            {copied ? 'Copied' : 'Copy token'}
                                        </Button>
                                    )}
                                </CopyButton>
                                <Button
                                    color="gray"
                                    onClick={() => setPlaintextToken(null)}
                                    size="xs"
                                    variant="subtle"
                                >
                                    I saved it
                                </Button>
                            </Group>
                        </Stack>
                    </Alert>
                )}

                <Paper
                    component="section"
                    aria-labelledby="create-token-heading"
                    withBorder
                    p={{ base: 'lg', sm: 'xl' }}
                >
                    <form autoComplete="off" onSubmit={handleSubmit}>
                        <Stack gap="md">
                            <Stack gap={4}>
                                <Title
                                    id="create-token-heading"
                                    order={2}
                                    size="h3"
                                >
                                    Create an app token
                                </Title>
                                <Text c="dimmed" size="sm">
                                    Use a separate token for each client so you
                                    can revoke access independently.
                                </Text>
                            </Stack>

                            <TextInput
                                disabled={createMutation.isPending}
                                error={nameTouched ? nameError : undefined}
                                label="Token name"
                                maxLength={100}
                                onBlur={() => setNameTouched(true)}
                                onChange={(event) => {
                                    setName(event.currentTarget.value);
                                    createMutation.reset();
                                }}
                                placeholder="Phone reader"
                                required
                                value={name}
                            />

                            <Checkbox.Group
                                error={scopesTouched ? scopesError : undefined}
                                label="Allowed APIs"
                                onChange={handleScopeChange}
                                required
                                value={[...scopes]}
                            >
                                <Stack gap="sm" mt="xs">
                                    {(
                                        Object.entries(scopePresentation) as [
                                            AppTokenScope,
                                            (typeof scopePresentation)[AppTokenScope],
                                        ][]
                                    ).map(([scope, presentation]) => (
                                        <Checkbox
                                            description={
                                                presentation.description
                                            }
                                            disabled={createMutation.isPending}
                                            key={scope}
                                            label={presentation.label}
                                            value={scope}
                                        />
                                    ))}
                                </Stack>
                            </Checkbox.Group>

                            {createMutation.isError && (
                                <Alert
                                    color="red"
                                    title="Token could not be created"
                                    role="alert"
                                >
                                    {createMutation.error.message}
                                </Alert>
                            )}

                            <Group justify="flex-end">
                                <Button
                                    disabled={
                                        nameError !== undefined ||
                                        scopesError !== undefined
                                    }
                                    leftSection={
                                        <IconKey aria-hidden="true" size={18} />
                                    }
                                    loading={createMutation.isPending}
                                    type="submit"
                                >
                                    Create token
                                </Button>
                            </Group>
                        </Stack>
                    </form>
                </Paper>

                <Stack
                    component="section"
                    gap="md"
                    aria-labelledby="active-tokens-heading"
                >
                    <Group justify="space-between" align="center">
                        <Title id="active-tokens-heading" order={2} size="h2">
                            Active tokens
                        </Title>
                        {tokensQuery.isFetching && !tokensQuery.isPending && (
                            <Group gap="xs" role="status" aria-live="polite">
                                <Loader size="xs" />
                                <Text c="dimmed" size="xs">
                                    Updating…
                                </Text>
                            </Group>
                        )}
                    </Group>

                    {tokensQuery.isPending && (
                        <Group
                            aria-live="polite"
                            justify="center"
                            py="xl"
                            role="status"
                        >
                            <Loader size="sm" />
                            <Text size="sm">Loading app tokens…</Text>
                        </Group>
                    )}

                    {tokensQuery.isError && (
                        <Alert
                            color="red"
                            title="App tokens are unavailable"
                            role="alert"
                        >
                            <Stack align="flex-start" gap="sm">
                                <Text size="sm">
                                    {tokensQuery.error.message}
                                </Text>
                                <Button
                                    leftSection={
                                        <IconRefresh
                                            aria-hidden="true"
                                            size={16}
                                        />
                                    }
                                    onClick={() => void tokensQuery.refetch()}
                                    size="xs"
                                    variant="light"
                                >
                                    Try again
                                </Button>
                            </Stack>
                        </Alert>
                    )}

                    {tokensQuery.data !== undefined && (
                        <AppTokenList
                            tokens={sortedTokens}
                            onRevoke={openRevokeConfirmation}
                        />
                    )}
                </Stack>
            </Stack>
        </Container>
    );
}
