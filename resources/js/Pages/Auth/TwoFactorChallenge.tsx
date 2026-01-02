import { Head, useForm } from '@inertiajs/react';
import {
    Anchor,
    Button,
    Container,
    Paper,
    PinInput,
    Stack,
    Text,
    Textarea,
    Title,
} from '@mantine/core';
import { useState } from 'react';

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
        <Container size={420} my={40}>
            <Head title="Two-Factor Authentication" />

            <Title ta="center">Two-Factor Authentication</Title>
            <Text c="dimmed" size="sm" ta="center" mt={5}>
                {useRecoveryCode
                    ? 'Enter one of your emergency recovery codes to continue.'
                    : 'Enter the 6-digit code from your authenticator app to continue.'}
            </Text>

            <Paper
                withBorder
                shadow="md"
                p={30}
                mt={30}
                radius="md"
                component="form"
                onSubmit={handleSubmit}
            >
                <Stack gap="md">
                    {useRecoveryCode ? (
                        <Textarea
                            label="Recovery Code"
                            placeholder="XXXXX-XXXXX"
                            value={data.recovery_code}
                            onChange={(e) =>
                                setData('recovery_code', e.target.value)
                            }
                            error={errors.recovery_code}
                            autoFocus
                        />
                    ) : (
                        <Stack align="center" gap="xs">
                            <Text size="sm" fw={500}>
                                Authentication Code
                            </Text>
                            <PinInput
                                length={6}
                                type="number"
                                value={data.code}
                                onChange={(value) => setData('code', value)}
                                error={!!errors.code}
                                autoFocus
                                oneTimeCode
                            />
                            {errors.code && (
                                <Text size="sm" c="red">
                                    {errors.code}
                                </Text>
                            )}
                        </Stack>
                    )}

                    <Button fullWidth type="submit" loading={processing}>
                        {useRecoveryCode ? 'Verify Recovery Code' : 'Verify'}
                    </Button>

                    <Anchor
                        component="button"
                        type="button"
                        size="sm"
                        ta="center"
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
            </Paper>
        </Container>
    );
}
