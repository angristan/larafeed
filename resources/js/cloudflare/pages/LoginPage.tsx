import { Alert, Button, Group, Loader, Stack, Text } from '@mantine/core';
import { IconFingerprint, IconInfoCircle } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Effect } from 'effect';
import { type ReactElement, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';

import {
    AuthClientError,
    getAuthenticationOptions,
    verifyAuthentication,
} from '../api/auth';
import {
    AUTH_TURNSTILE_ACTIONS,
    PasskeyCeremonyError,
    requestAuthentication,
    supportsPasskeys,
} from '../auth/ceremony';
import { AuthCard } from '../components/AuthCard';
import {
    Turnstile,
    TurnstileError,
    type TurnstileHandle,
} from '../components/Turnstile';
import { authConfigQueryOptions, authKeys } from '../queries/auth';

function safeReturnTo(search: string): string {
    const returnTo = new URLSearchParams(search).get('returnTo');
    if (
        returnTo === null ||
        !returnTo.startsWith('/') ||
        returnTo.startsWith('//')
    ) {
        return '/';
    }

    return returnTo;
}

function errorPresentation(error: Error): {
    readonly title: string;
    readonly message: string;
} {
    if (error instanceof PasskeyCeremonyError) {
        return {
            title:
                error.kind === 'canceled'
                    ? 'Passkey request canceled'
                    : 'Passkey unavailable',
            message: error.message,
        };
    }

    if (error instanceof TurnstileError || error instanceof AuthClientError) {
        return { title: 'Sign-in failed', message: error.message };
    }

    return {
        title: 'Sign-in failed',
        message: 'Larafeed could not sign you in. Try again.',
    };
}

export function LoginPage(): ReactElement {
    const configQuery = useQuery(authConfigQueryOptions);
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const location = useLocation();
    const turnstileRef = useRef<TurnstileHandle>(null);
    const passkeysSupported = supportsPasskeys();

    const loginMutation = useMutation({
        mutationKey: [...authKeys.all, 'login'],
        retry: false,
        mutationFn: async () => {
            const turnstile = turnstileRef.current;
            if (turnstile === null) {
                throw new TurnstileError(
                    'script',
                    'Human verification is not ready.',
                );
            }

            const optionsToken = await turnstile.execute(
                AUTH_TURNSTILE_ACTIONS.authenticationOptions,
            );
            const ceremony = await Effect.runPromise(
                getAuthenticationOptions({ turnstileToken: optionsToken }),
            );
            const response = await requestAuthentication(ceremony.options);
            const verifyToken = await turnstile.execute(
                AUTH_TURNSTILE_ACTIONS.authenticationVerify,
            );

            return Effect.runPromise(
                verifyAuthentication({
                    challengeId: ceremony.challengeId,
                    turnstileToken: verifyToken,
                    response,
                }),
            );
        },
        onSuccess: (session) => {
            queryClient.setQueryData(authKeys.session(), session);
            void navigate(safeReturnTo(location.search), { replace: true });
        },
    });

    const presentedError = loginMutation.error
        ? errorPresentation(loginMutation.error)
        : undefined;

    return (
        <AuthCard
            title="Welcome back"
            description="Use a passkey saved on this device or another nearby device."
        >
            {!passkeysSupported && (
                <Alert
                    color="orange"
                    icon={<IconInfoCircle aria-hidden="true" size={18} />}
                    title="Passkeys are not supported"
                    role="alert"
                >
                    Open Larafeed in a current browser on a device that supports
                    WebAuthn.
                </Alert>
            )}

            {configQuery.isPending && (
                <Group justify="center" py="md" aria-live="polite">
                    <Loader size="sm" />
                    <Text size="sm">Preparing secure sign-in…</Text>
                </Group>
            )}

            {configQuery.isError && (
                <Alert color="red" title="Sign-in is unavailable" role="alert">
                    <Stack gap="sm">
                        <Text size="sm">{configQuery.error.message}</Text>
                        <Button
                            onClick={() => void configQuery.refetch()}
                            size="xs"
                            variant="light"
                        >
                            Try again
                        </Button>
                    </Stack>
                </Alert>
            )}

            {presentedError !== undefined && (
                <Alert color="red" title={presentedError.title} role="alert">
                    {presentedError.message}
                </Alert>
            )}

            {configQuery.data !== undefined && (
                <Turnstile
                    ref={turnstileRef}
                    siteKey={configQuery.data.turnstileSiteKey}
                />
            )}

            <Button
                type="button"
                size="md"
                fullWidth
                leftSection={<IconFingerprint aria-hidden="true" size={20} />}
                loading={loginMutation.isPending}
                disabled={!passkeysSupported || configQuery.data === undefined}
                onClick={() => loginMutation.mutate()}
            >
                Continue with a passkey
            </Button>

            <Text c="dimmed" size="xs" ta="center">
                Larafeed does not use passwords. Access is limited to invited
                users.
            </Text>
        </AuthCard>
    );
}
