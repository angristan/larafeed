import {
    Alert,
    Badge,
    Button,
    Code,
    CopyButton,
    Group,
    Loader,
    Modal,
    Stack,
    Switch,
    Text,
    Title,
} from '@mantine/core';
import {
    IconArrowRight,
    IconCheck,
    IconCopy,
    IconPlugConnectedX,
    IconRefresh,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocation } from 'react-router';

import type { McpConnectedClient } from '../api/mcp';
import { authorizationReturnTarget } from '../auth/returnTo';
import {
    ApplicationPage,
    ApplicationSettingsContent,
    ApplicationWorkSurface,
} from '../components/ApplicationPage';
import {
    disconnectMcpClientMutationOptions,
    mcpSettingsQueryOptions,
    updateMcpSettingsMutationOptions,
} from '../queries/mcp';

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
});

function ConnectedClientRow({
    client,
    onDisconnect,
}: {
    readonly client: McpConnectedClient;
    readonly onDisconnect: (client: McpConnectedClient) => void;
}) {
    const canWrite = client.scopes.includes('mcp:write');
    return (
        <Stack
            component="li"
            gap="xs"
            py="md"
            style={{
                borderBottom: '1px solid var(--ds-line)',
                listStyle: 'none',
            }}
        >
            <Group justify="space-between" align="flex-start" wrap="wrap">
                <Stack gap={2}>
                    <Group gap="xs">
                        <Text fw={600}>{client.clientName}</Text>
                        <Badge
                            color={canWrite ? 'blue' : 'gray'}
                            size="sm"
                            variant="light"
                        >
                            {canWrite ? 'Read and write' : 'Read only'}
                        </Badge>
                    </Group>
                    <Text c="dimmed" size="xs">
                        {client.clientDomain === null
                            ? 'Unverified app name'
                            : `Published by ${client.clientDomain}`}
                    </Text>
                </Stack>
                <Button
                    color="red"
                    leftSection={
                        <IconPlugConnectedX aria-hidden="true" size={16} />
                    }
                    onClick={() => onDisconnect(client)}
                    size="xs"
                    variant="light"
                >
                    Disconnect
                </Button>
            </Group>
            <Text c="dimmed" size="xs">
                Connected {dateTimeFormatter.format(new Date(client.createdAt))}
                {client.expiresAt === null
                    ? ''
                    : ` · expires ${dateTimeFormatter.format(new Date(client.expiresAt))} unless used`}
            </Text>
        </Stack>
    );
}

export function McpPage() {
    const queryClient = useQueryClient();
    const location = useLocation();
    const settingsQuery = useQuery(mcpSettingsQueryOptions);
    const updateMutation = useMutation(
        updateMcpSettingsMutationOptions(queryClient),
    );
    const disconnectMutation = useMutation(
        disconnectMcpClientMutationOptions(queryClient),
    );
    const [confirmingDisable, setConfirmingDisable] = useState(false);
    const [clientToDisconnect, setClientToDisconnect] =
        useState<McpConnectedClient | null>(null);

    const settings = settingsQuery.data;
    // The authorization page links here when MCP access is off.
    const returnTo = authorizationReturnTarget(location.search);

    const handleToggle = (enabled: boolean) => {
        updateMutation.reset();
        // Turning MCP off disconnects every client, so confirm when there is
        // anything to lose.
        if (!enabled && (settings?.clients.length ?? 0) > 0) {
            setConfirmingDisable(true);
            return;
        }
        updateMutation.mutate(enabled);
    };

    const confirmDisable = () => {
        updateMutation.mutate(false, {
            onSuccess: () => setConfirmingDisable(false),
        });
    };

    const confirmDisconnect = () => {
        if (clientToDisconnect === null) return;
        disconnectMutation.mutate(clientToDisconnect.grantId, {
            onSuccess: () => setClientToDisconnect(null),
        });
    };

    return (
        <ApplicationPage
            activePage="settings"
            pageTitle="MCP"
            settingsNavigation
        >
            <Modal
                centered
                closeOnClickOutside={!updateMutation.isPending}
                closeOnEscape={!updateMutation.isPending}
                onClose={() => setConfirmingDisable(false)}
                opened={confirmingDisable}
                title="Turn off MCP access?"
            >
                <Stack gap="md">
                    <Text size="sm">
                        All {settings?.clients.length ?? 0} connected apps lose
                        access immediately. Turning MCP on again does not
                        reconnect them.
                    </Text>
                    {updateMutation.isError && (
                        <Alert color="red" role="alert" title="Not changed">
                            {updateMutation.error.message}
                        </Alert>
                    )}
                    <Group justify="flex-end">
                        <Button
                            disabled={updateMutation.isPending}
                            onClick={() => setConfirmingDisable(false)}
                            variant="default"
                        >
                            Cancel
                        </Button>
                        <Button
                            color="red"
                            loading={updateMutation.isPending}
                            onClick={confirmDisable}
                        >
                            Turn off and disconnect
                        </Button>
                    </Group>
                </Stack>
            </Modal>

            <Modal
                centered
                closeOnClickOutside={!disconnectMutation.isPending}
                closeOnEscape={!disconnectMutation.isPending}
                onClose={() => setClientToDisconnect(null)}
                opened={clientToDisconnect !== null}
                title="Disconnect app?"
            >
                <Stack gap="md">
                    <Text size="sm">
                        <strong>{clientToDisconnect?.clientName}</strong> loses
                        access immediately. You can connect it again later.
                    </Text>
                    {disconnectMutation.isError && (
                        <Alert
                            color="red"
                            role="alert"
                            title="Not disconnected"
                        >
                            {disconnectMutation.error.message}
                        </Alert>
                    )}
                    <Group justify="flex-end">
                        <Button
                            disabled={disconnectMutation.isPending}
                            onClick={() => setClientToDisconnect(null)}
                            variant="default"
                        >
                            Cancel
                        </Button>
                        <Button
                            color="red"
                            loading={disconnectMutation.isPending}
                            onClick={confirmDisconnect}
                        >
                            Disconnect
                        </Button>
                    </Group>
                </Stack>
            </Modal>

            <ApplicationSettingsContent
                description="Let AI assistants read your feeds and manage your reading through the Model Context Protocol."
                title="MCP"
            >
                <Stack gap="md">
                    {settingsQuery.isPending && (
                        <Group
                            aria-live="polite"
                            justify="center"
                            py="xl"
                            role="status"
                        >
                            <Loader size="sm" />
                            <Text size="sm">Loading MCP settings…</Text>
                        </Group>
                    )}

                    {settingsQuery.isError && (
                        <Alert
                            color="red"
                            role="alert"
                            title="MCP settings are unavailable"
                        >
                            <Stack align="flex-start" gap="sm">
                                <Text size="sm">
                                    {settingsQuery.error.message}
                                </Text>
                                <Button
                                    leftSection={
                                        <IconRefresh
                                            aria-hidden="true"
                                            size={16}
                                        />
                                    }
                                    onClick={() => void settingsQuery.refetch()}
                                    size="xs"
                                    variant="light"
                                >
                                    Try again
                                </Button>
                            </Stack>
                        </Alert>
                    )}

                    {settings !== undefined && (
                        <>
                            <ApplicationWorkSurface>
                                <Stack gap="md">
                                    <Switch
                                        checked={settings.enabled}
                                        description="Off by default. While off, apps cannot connect and existing connections stop working."
                                        disabled={updateMutation.isPending}
                                        label="Allow MCP access"
                                        onChange={(event) =>
                                            handleToggle(
                                                event.currentTarget.checked,
                                            )
                                        }
                                        size="md"
                                    />
                                    {updateMutation.isError &&
                                        !confirmingDisable && (
                                            <Alert
                                                color="red"
                                                role="alert"
                                                title="Not changed"
                                            >
                                                {updateMutation.error.message}
                                            </Alert>
                                        )}
                                    {settings.enabled && returnTo !== null && (
                                        <Alert
                                            color="blue"
                                            title="Finish connecting your app"
                                        >
                                            <Stack align="flex-start" gap="sm">
                                                <Text size="sm">
                                                    MCP access is on. Continue
                                                    to review what the app can
                                                    do.
                                                </Text>
                                                <Button
                                                    component="a"
                                                    href={returnTo}
                                                    rightSection={
                                                        <IconArrowRight
                                                            aria-hidden="true"
                                                            size={16}
                                                        />
                                                    }
                                                    size="xs"
                                                >
                                                    Continue
                                                </Button>
                                            </Stack>
                                        </Alert>
                                    )}
                                </Stack>
                            </ApplicationWorkSurface>

                            <ApplicationWorkSurface>
                                <Stack
                                    aria-labelledby="mcp-connect-heading"
                                    component="section"
                                    gap="sm"
                                >
                                    <Title
                                        id="mcp-connect-heading"
                                        order={2}
                                        size="h3"
                                    >
                                        Connect an app
                                    </Title>
                                    <Text c="dimmed" size="sm">
                                        Add this URL as a remote MCP server
                                        (Streamable HTTP) in your MCP client.
                                        The client opens Larafeed in your
                                        browser so you can approve access. No
                                        token to copy.
                                    </Text>
                                    <Group gap="xs" wrap="nowrap">
                                        <Code
                                            aria-label="MCP server URL"
                                            style={{ overflowWrap: 'anywhere' }}
                                        >
                                            {settings.endpointUrl}
                                        </Code>
                                        <CopyButton
                                            value={settings.endpointUrl}
                                        >
                                            {({ copied, copy }) => (
                                                <Button
                                                    color={
                                                        copied ? 'teal' : 'blue'
                                                    }
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
                                                    {copied ? 'Copied' : 'Copy'}
                                                </Button>
                                            )}
                                        </CopyButton>
                                    </Group>
                                    <Text c="dimmed" size="xs">
                                        Apps can list feeds and articles, read
                                        article text, mark articles read,
                                        starred, or archived, and subscribe or
                                        unsubscribe. You choose read-only or
                                        read and write access when you approve.
                                    </Text>
                                </Stack>
                            </ApplicationWorkSurface>

                            <ApplicationWorkSurface>
                                <Stack
                                    aria-labelledby="mcp-clients-heading"
                                    component="section"
                                    gap="xs"
                                >
                                    <Title
                                        id="mcp-clients-heading"
                                        order={2}
                                        size="h3"
                                    >
                                        Connected apps
                                    </Title>
                                    {settings.clients.length === 0 ? (
                                        <Text c="dimmed" size="sm">
                                            {settings.enabled
                                                ? 'No apps are connected.'
                                                : 'Turn on MCP access to connect an app.'}
                                        </Text>
                                    ) : (
                                        <Stack
                                            component="ul"
                                            gap={0}
                                            m={0}
                                            p={0}
                                        >
                                            {settings.clients.map((client) => (
                                                <ConnectedClientRow
                                                    client={client}
                                                    key={client.grantId}
                                                    onDisconnect={(value) => {
                                                        disconnectMutation.reset();
                                                        setClientToDisconnect(
                                                            value,
                                                        );
                                                    }}
                                                />
                                            ))}
                                        </Stack>
                                    )}
                                </Stack>
                            </ApplicationWorkSurface>
                        </>
                    )}
                </Stack>
            </ApplicationSettingsContent>
        </ApplicationPage>
    );
}
