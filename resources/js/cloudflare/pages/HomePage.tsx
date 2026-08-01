import {
    Alert,
    Avatar,
    Badge,
    Button,
    Container,
    Group,
    Paper,
    Stack,
    Text,
    Title,
} from '@mantine/core';
import { IconLogout, IconRss } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Effect } from 'effect';
import { Navigate, useNavigate } from 'react-router';

import { AuthClientError, logout, readCsrfToken } from '../api/auth';
import {
    authKeys,
    authSessionQueryOptions,
    clearAuthenticatedCache,
    isUnauthenticatedError,
} from '../queries/auth';

export function HomePage() {
    const sessionQuery = useQuery(authSessionQueryOptions);
    const queryClient = useQueryClient();
    const navigate = useNavigate();

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
            }
        },
    });

    if (sessionQuery.data !== undefined && !sessionQuery.data.authenticated) {
        return <Navigate to="/login" replace />;
    }

    if (sessionQuery.data === undefined || !sessionQuery.data.authenticated) {
        return null;
    }

    const { user, expiresAt } = sessionQuery.data;

    return (
        <Container component="main" size="md" py={{ base: 'lg', sm: 'xl' }}>
            <Stack gap="xl">
                <Group justify="space-between" align="flex-start" wrap="wrap">
                    <Stack gap={2}>
                        <Title order={1}>Larafeed</Title>
                        <Text c="dimmed">Your private feed reader.</Text>
                    </Stack>

                    <Group gap="sm">
                        <Avatar color="blue" name={user.displayName} />
                        <Stack gap={0} visibleFrom="xs">
                            <Text fw={600} size="sm">
                                {user.displayName}
                            </Text>
                            <Text c="dimmed" size="xs">
                                @{user.username}
                            </Text>
                        </Stack>
                        <Button
                            type="button"
                            variant="subtle"
                            color="gray"
                            leftSection={
                                <IconLogout aria-hidden="true" size={18} />
                            }
                            loading={logoutMutation.isPending}
                            onClick={() => logoutMutation.mutate()}
                        >
                            Sign out
                        </Button>
                    </Group>
                </Group>

                {logoutMutation.isError &&
                    !isUnauthenticatedError(logoutMutation.error) && (
                        <Alert color="red" title="Sign-out failed" role="alert">
                            {logoutMutation.error.message}
                        </Alert>
                    )}

                <Paper
                    component="section"
                    withBorder
                    p={{ base: 'lg', sm: 'xl' }}
                >
                    <Stack gap="md" align="flex-start">
                        <Group gap="sm">
                            <IconRss aria-hidden="true" size={24} />
                            <Title order={2} size="h3">
                                Reader setup is next
                            </Title>
                        </Group>
                        <Text c="dimmed" maw={560}>
                            Your passkey session is active. Feeds, categories,
                            and entries will appear here as the reader migration
                            continues.
                        </Text>
                        <Group gap="xs">
                            <Badge color="green" variant="light">
                                Signed in
                            </Badge>
                            {user.isAdmin && (
                                <Badge color="blue" variant="light">
                                    Administrator
                                </Badge>
                            )}
                        </Group>
                        <Text c="dimmed" size="xs">
                            Session expires{' '}
                            {new Intl.DateTimeFormat(undefined, {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                            }).format(new Date(expiresAt))}
                        </Text>
                    </Stack>
                </Paper>
            </Stack>
        </Container>
    );
}
