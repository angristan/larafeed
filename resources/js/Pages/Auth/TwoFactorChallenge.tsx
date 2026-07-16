import { Head, useForm } from '@inertiajs/react';
import {
    Alert,
    Anchor,
    Button,
    PinInput,
    Stack,
    Text,
    Textarea,
} from '@mantine/core';
import { IconShieldCheck } from '@tabler/icons-react';
import { useState } from 'react';
import AuthLayout from '@/Layouts/AuthLayout/AuthLayout';

export default function TwoFactorChallenge() {
    const [useRecoveryCode, setUseRecoveryCode] = useState(false);

    const { data, setData, post, processing, errors } = useForm({
        code: '',
        recovery_code: '',
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        post(route('two-factor.login'));
    };

    return (
        <AuthLayout
            title="Two-factor authentication"
            description={
                useRecoveryCode
                    ? 'Enter one of your emergency recovery codes to continue.'
                    : 'Enter the 6-digit code from your authenticator app.'
            }
            icon={<IconShieldCheck size={22} stroke={1.7} />}
        >
            <Head title="Two-Factor Authentication" />

            <form onSubmit={handleSubmit}>
                <Stack gap="md">
                    {useRecoveryCode ? (
                        <Textarea
                            label="Recovery code"
                            placeholder="XXXXX-XXXXX"
                            name="recovery_code"
                            value={data.recovery_code}
                            onChange={(event) =>
                                setData(
                                    'recovery_code',
                                    event.currentTarget.value,
                                )
                            }
                            error={errors.recovery_code}
                            autoFocus
                            autoComplete="one-time-code"
                            required
                        />
                    ) : (
                        <Stack align="center" gap="xs">
                            <Text size="sm" fw={600} id="auth-code-label">
                                Authentication code
                            </Text>
                            <PinInput
                                length={6}
                                size="xs"
                                gap="xs"
                                type="number"
                                value={data.code}
                                onChange={(value) => setData('code', value)}
                                error={!!errors.code}
                                autoFocus
                                oneTimeCode
                                aria-labelledby="auth-code-label"
                                getInputProps={(index) => ({
                                    'aria-label': `Authentication code digit ${index + 1} of 6`,
                                })}
                            />
                            {errors.code && (
                                <Alert
                                    color="red"
                                    variant="light"
                                    role="alert"
                                    w="100%"
                                >
                                    {errors.code}
                                </Alert>
                            )}
                        </Stack>
                    )}

                    <Button
                        fullWidth
                        size="md"
                        type="submit"
                        loading={processing}
                        disabled={processing}
                    >
                        {useRecoveryCode ? 'Verify Recovery Code' : 'Verify'}
                    </Button>

                    <Anchor
                        component="button"
                        type="button"
                        size="sm"
                        ta="center"
                        disabled={processing}
                        onClick={() => {
                            setUseRecoveryCode(!useRecoveryCode);
                            setData({
                                code: '',
                                recovery_code: '',
                            });
                        }}
                    >
                        {useRecoveryCode
                            ? 'Use authenticator code instead'
                            : 'Use a recovery code instead'}
                    </Anchor>
                </Stack>
            </form>
        </AuthLayout>
    );
}
