import {
    Alert,
    Button,
    Group,
    Loader,
    Stack,
    Text,
    TextInput,
} from '@mantine/core';
import type { AccessLinkPurpose } from '@shared/schemas/auth';
import { IconFingerprint, IconInfoCircle } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Effect } from 'effect';
import { type FormEvent, type ReactElement, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import {
    AuthClientError,
    getAccessRegistrationOptions,
    verifyAccessRegistration,
} from '../api/auth';
import {
    clearCapturedAccessToken,
    getCapturedAccessToken,
} from '../auth/accessToken';
import {
    AUTH_TURNSTILE_ACTIONS,
    PasskeyCeremonyError,
    requestRegistration,
    supportsPasskeys,
} from '../auth/ceremony';
import { AuthCard } from '../components/AuthCard';
import {
    Turnstile,
    TurnstileError,
    type TurnstileHandle,
} from '../components/Turnstile';
import { useDocumentTitle } from '../documentTitle';
import { authConfigQueryOptions, authKeys } from '../queries/auth';

interface AccessRegistrationPageProps {
    readonly purpose: AccessLinkPurpose;
}

class RegistrationPurposeError extends Error {
    constructor() {
        super('This access link does not match this page.');
        this.name = 'RegistrationPurposeError';
    }
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
                    : 'Passkey could not be saved',
            message: error.message,
        };
    }

    if (
        error instanceof RegistrationPurposeError ||
        (error instanceof AuthClientError &&
            error.code === 'access_link_invalid')
    ) {
        return {
            title: 'Access link is invalid',
            message:
                'Ask an administrator for a new link. Links are short-lived and can be used once.',
        };
    }

    if (error instanceof TurnstileError || error instanceof AuthClientError) {
        return { title: 'Passkey setup failed', message: error.message };
    }

    return {
        title: 'Passkey setup failed',
        message: 'Larafeed could not save this passkey. Try again.',
    };
}

export function AccessRegistrationPage({
    purpose,
}: AccessRegistrationPageProps): ReactElement {
    useDocumentTitle(
        purpose === 'enrollment'
            ? 'Create your passkey'
            : 'Recover your account',
    );
    const configQuery = useQuery(authConfigQueryOptions);
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const turnstileRef = useRef<TurnstileHandle>(null);
    const [name, setName] = useState('My passkey');
    const [nameTouched, setNameTouched] = useState(false);
    const accessToken = getCapturedAccessToken(purpose);
    const passkeysSupported = supportsPasskeys();
    const normalizedName = name.trim();
    const nameError =
        normalizedName.length === 0
            ? 'Enter a name for this passkey.'
            : normalizedName.length > 100
              ? 'Use 100 characters or fewer.'
              : undefined;

    const registrationMutation = useMutation({
        mutationKey: [...authKeys.all, purpose, 'registration'],
        retry: false,
        mutationFn: async (passkeyName: string) => {
            if (accessToken === undefined) {
                throw new AuthClientError(
                    'status',
                    'The access link is missing or invalid.',
                    400,
                    'access_link_invalid',
                );
            }

            const turnstile = turnstileRef.current;
            if (turnstile === null) {
                throw new TurnstileError(
                    'script',
                    'Human verification is not ready.',
                );
            }

            const optionsToken = await turnstile.execute(
                AUTH_TURNSTILE_ACTIONS.registrationOptions,
            );
            const ceremony = await Effect.runPromise(
                getAccessRegistrationOptions({
                    accessToken,
                    turnstileToken: optionsToken,
                }),
            );

            if (ceremony.purpose !== purpose) {
                throw new RegistrationPurposeError();
            }

            const response = await requestRegistration(ceremony.options);
            const verifyToken = await turnstile.execute(
                AUTH_TURNSTILE_ACTIONS.registrationVerify,
            );

            return Effect.runPromise(
                verifyAccessRegistration({
                    accessToken,
                    challengeId: ceremony.challengeId,
                    name: passkeyName,
                    turnstileToken: verifyToken,
                    response,
                }),
            );
        },
        onSuccess: (session) => {
            clearCapturedAccessToken();
            queryClient.setQueryData(authKeys.session(), session);
            void navigate('/', { replace: true });
        },
    });

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setNameTouched(true);

        if (nameError === undefined) {
            registrationMutation.mutate(normalizedName);
        }
    };

    const content =
        purpose === 'enrollment'
            ? {
                  title: 'Create your passkey',
                  description:
                      'Your invitation gives you private access to Larafeed.',
                  submit: 'Create passkey',
              }
            : {
                  title: 'Recover your account',
                  description:
                      'Create a new passkey. Existing sessions will be signed out.',
                  submit: 'Create recovery passkey',
              };

    const presentedError = registrationMutation.error
        ? errorPresentation(registrationMutation.error)
        : undefined;

    return (
        <AuthCard title={content.title} description={content.description}>
            {accessToken === undefined && (
                <Alert color="red" title="Access link is missing" role="alert">
                    Ask an administrator for a new link. For your security,
                    links are short-lived and can be used once.
                </Alert>
            )}

            {!passkeysSupported && (
                <Alert
                    color="orange"
                    icon={<IconInfoCircle aria-hidden="true" size={18} />}
                    title="Passkeys are not supported"
                    role="alert"
                >
                    Open this link in a current browser on a device that
                    supports WebAuthn.
                </Alert>
            )}

            {configQuery.isPending && (
                <Group justify="center" py="md" aria-live="polite">
                    <Loader size="sm" />
                    <Text size="sm">Preparing secure setup…</Text>
                </Group>
            )}

            {configQuery.isError && (
                <Alert color="red" title="Setup is unavailable" role="alert">
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

            <form onSubmit={handleSubmit}>
                <Stack gap="md">
                    <TextInput
                        label="Passkey name"
                        description="Use a name that helps you recognize this device."
                        placeholder="MacBook Touch ID"
                        value={name}
                        onChange={(event) => setName(event.currentTarget.value)}
                        onBlur={() => setNameTouched(true)}
                        error={nameTouched ? nameError : undefined}
                        maxLength={100}
                        required
                        autoComplete="off"
                        disabled={registrationMutation.isPending}
                    />

                    {configQuery.data !== undefined && (
                        <Turnstile
                            ref={turnstileRef}
                            siteKey={configQuery.data.turnstileSiteKey}
                        />
                    )}

                    <Button
                        type="submit"
                        size="md"
                        fullWidth
                        leftSection={
                            <IconFingerprint aria-hidden="true" size={20} />
                        }
                        loading={registrationMutation.isPending}
                        disabled={
                            accessToken === undefined ||
                            !passkeysSupported ||
                            configQuery.data === undefined
                        }
                    >
                        {content.submit}
                    </Button>
                </Stack>
            </form>
        </AuthCard>
    );
}
