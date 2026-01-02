import { router, useForm } from '@inertiajs/react';
import {
    Alert,
    Badge,
    Box,
    Button,
    Code,
    CopyButton,
    Group,
    Modal,
    Paper,
    PasswordInput,
    PinInput,
    SimpleGrid,
    Stack,
    Text,
    Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
    IconCheck,
    IconCopy,
    IconShieldCheck,
    IconShieldOff,
} from '@tabler/icons-react';
import { useCallback, useState } from 'react';

interface TwoFactorSettingsProps {
    twoFactorEnabled: boolean;
    twoFactorConfirmed: boolean;
}

type SetupStep = 'qrcode' | 'confirm' | 'recovery';

const TwoFactorSettings = ({
    twoFactorEnabled,
    twoFactorConfirmed,
}: TwoFactorSettingsProps) => {
    const [setupModalOpened, setupModalHandlers] = useDisclosure(false);
    const [disableModalOpened, disableModalHandlers] = useDisclosure(false);
    const [recoveryModalOpened, recoveryModalHandlers] = useDisclosure(false);

    const [setupStep, setSetupStep] = useState<SetupStep>('qrcode');
    const [qrCodeSvg, setQrCodeSvg] = useState<string | null>(null);
    const [setupKey, setSetupKey] = useState<string | null>(null);
    const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

    const [enabling, setEnabling] = useState(false);

    const {
        data: confirmData,
        setData: setConfirmData,
        post: postConfirm,
        processing: confirmProcessing,
        errors: confirmErrors,
        reset: resetConfirm,
    } = useForm({
        code: '',
    });

    const { delete: deleteRequest, processing: disableProcessing } = useForm(
        {},
    );

    const [recoveryPassword, setRecoveryPassword] = useState('');
    const [recoveryPasswordError, setRecoveryPasswordError] = useState<
        string | null
    >(null);
    const [recoveryPasswordLoading, setRecoveryPasswordLoading] =
        useState(false);
    const [showRecoveryPasswordPrompt, setShowRecoveryPasswordPrompt] =
        useState(true);

    const [disablePassword, setDisablePassword] = useState('');
    const [disablePasswordError, setDisablePasswordError] = useState<
        string | null
    >(null);
    const [disablePasswordLoading, setDisablePasswordLoading] = useState(false);
    const [showDisablePasswordPrompt, setShowDisablePasswordPrompt] =
        useState(true);

    const fetchQrCode = useCallback(async () => {
        try {
            const response = await fetch(route('two-factor.qr-code'), {
                headers: {
                    Accept: 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                },
            });
            const data = await response.json();
            setQrCodeSvg(data.svg);
        } catch {
            notifications.show({
                title: 'Error',
                message: 'Failed to load QR code',
                color: 'red',
            });
        }
    }, []);

    const fetchSetupKey = useCallback(async () => {
        try {
            const response = await fetch(route('two-factor.secret-key'), {
                headers: {
                    Accept: 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                },
            });
            const data = await response.json();
            setSetupKey(data.secretKey);
        } catch {
            // Secret key endpoint might not exist, that's ok
        }
    }, []);

    const fetchRecoveryCodes = useCallback(async () => {
        try {
            const response = await fetch(route('two-factor.recovery-codes'), {
                headers: {
                    Accept: 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                },
            });
            const data = await response.json();
            setRecoveryCodes(data);
        } catch {
            notifications.show({
                title: 'Error',
                message: 'Failed to load recovery codes',
                color: 'red',
            });
        }
    }, []);

    const handleEnableStart = () => {
        setEnabling(true);
        router.post(
            route('two-factor.enable'),
            {},
            {
                preserveScroll: true,
                onSuccess: async () => {
                    await Promise.all([fetchQrCode(), fetchSetupKey()]);
                    setSetupStep('qrcode');
                    setupModalHandlers.open();
                    setEnabling(false);
                },
                onError: () => {
                    notifications.show({
                        title: 'Error',
                        message: 'Failed to enable two-factor authentication',
                        color: 'red',
                    });
                    setEnabling(false);
                },
            },
        );
    };

    const handleConfirmCode = (e: React.FormEvent) => {
        e.preventDefault();

        postConfirm(route('two-factor.confirm'), {
            preserveScroll: true,
            onSuccess: async () => {
                await fetchRecoveryCodes();
                setSetupStep('recovery');
                notifications.show({
                    title: 'Success',
                    message: 'Two-factor authentication has been enabled',
                    color: 'green',
                });
            },
        });
    };

    const handleSetupComplete = () => {
        setupModalHandlers.close();
        setSetupStep('qrcode');
        setQrCodeSvg(null);
        setSetupKey(null);
        resetConfirm();
        router.reload({ only: ['auth'] });
    };

    const handleOpenDisableModal = () => {
        setShowDisablePasswordPrompt(true);
        setDisablePassword('');
        setDisablePasswordError(null);
        disableModalHandlers.open();
    };

    const handleCloseDisableModal = () => {
        disableModalHandlers.close();
        setDisablePassword('');
        setDisablePasswordError(null);
        setShowDisablePasswordPrompt(true);
    };

    const handleDisablePasswordSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setDisablePasswordLoading(true);
        setDisablePasswordError(null);

        try {
            await window.axios.post(route('password.confirm'), {
                password: disablePassword,
            });
            setShowDisablePasswordPrompt(false);
        } catch (err) {
            const error = err as {
                response?: {
                    status?: number;
                    data?: { errors?: { password?: string[] } };
                };
            };
            if (error.response?.status === 422) {
                setDisablePasswordError(
                    error.response.data?.errors?.password?.[0] ||
                        'Invalid password',
                );
            } else {
                notifications.show({
                    title: 'Error',
                    message: 'Failed to verify password',
                    color: 'red',
                });
            }
        } finally {
            setDisablePasswordLoading(false);
        }
    };

    const handleDisable = () => {
        deleteRequest(route('two-factor.disable'), {
            preserveScroll: true,
            onSuccess: () => {
                handleCloseDisableModal();
                notifications.show({
                    title: 'Success',
                    message: 'Two-factor authentication has been disabled',
                    color: 'green',
                });
                router.reload({ only: ['auth'] });
            },
            onError: () => {
                notifications.show({
                    title: 'Error',
                    message: 'Failed to disable two-factor authentication',
                    color: 'red',
                });
            },
        });
    };

    const handleShowRecoveryCodes = () => {
        setShowRecoveryPasswordPrompt(true);
        setRecoveryPassword('');
        setRecoveryPasswordError(null);
        setRecoveryCodes([]);
        recoveryModalHandlers.open();
    };

    const handleRecoveryPasswordSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setRecoveryPasswordLoading(true);
        setRecoveryPasswordError(null);

        try {
            await window.axios.post(route('password.confirm'), {
                password: recoveryPassword,
            });

            await fetchRecoveryCodes();
            setShowRecoveryPasswordPrompt(false);
        } catch (err) {
            const error = err as {
                response?: {
                    status?: number;
                    data?: { errors?: { password?: string[] } };
                };
            };
            if (error.response?.status === 422) {
                setRecoveryPasswordError(
                    error.response.data?.errors?.password?.[0] ||
                        'Invalid password',
                );
            } else {
                notifications.show({
                    title: 'Error',
                    message: 'Failed to verify password',
                    color: 'red',
                });
            }
        } finally {
            setRecoveryPasswordLoading(false);
        }
    };

    const handleCloseRecoveryModal = () => {
        recoveryModalHandlers.close();
        setRecoveryCodes([]);
        setRecoveryPassword('');
        setRecoveryPasswordError(null);
        setShowRecoveryPasswordPrompt(true);
    };

    const handleRegenerateRecoveryCodes = () => {
        router.post(
            route('two-factor.recovery-codes'),
            {},
            {
                preserveScroll: true,
                onSuccess: async () => {
                    await fetchRecoveryCodes();
                    notifications.show({
                        title: 'Success',
                        message: 'Recovery codes have been regenerated',
                        color: 'green',
                    });
                },
            },
        );
    };

    const isFullyEnabled = twoFactorEnabled && twoFactorConfirmed;

    return (
        <Stack gap="xl">
            <Stack gap={4}>
                <Group gap="sm">
                    <Title order={2}>Two-Factor Authentication</Title>
                    {isFullyEnabled ? (
                        <Badge
                            color="green"
                            leftSection={<IconShieldCheck size={12} />}
                        >
                            Enabled
                        </Badge>
                    ) : (
                        <Badge
                            color="gray"
                            leftSection={<IconShieldOff size={12} />}
                        >
                            Disabled
                        </Badge>
                    )}
                </Group>
                <Text size="sm" c="dimmed">
                    Add an extra layer of security to your account using a
                    time-based one-time password (TOTP) authenticator app.
                </Text>
            </Stack>

            <Paper withBorder p="md" radius="md" maw={520}>
                {isFullyEnabled ? (
                    <Stack gap="md">
                        <Alert color="green" variant="light">
                            <Text size="sm">
                                Two-factor authentication is enabled. You will
                                need to enter a code from your authenticator app
                                when logging in.
                            </Text>
                        </Alert>

                        <Group gap="sm">
                            <Button
                                variant="light"
                                onClick={handleShowRecoveryCodes}
                            >
                                View Recovery Codes
                            </Button>
                            <Button
                                variant="light"
                                color="red"
                                onClick={handleOpenDisableModal}
                            >
                                Disable 2FA
                            </Button>
                        </Group>
                    </Stack>
                ) : (
                    <Stack gap="md">
                        <Text size="sm">
                            When two-factor authentication is enabled, you will
                            be prompted for a secure, random token during
                            authentication. You may retrieve this token from
                            your phone&apos;s authenticator application (like
                            Google Authenticator or 1Password).
                        </Text>

                        <Button onClick={handleEnableStart} loading={enabling}>
                            Enable Two-Factor Authentication
                        </Button>
                    </Stack>
                )}
            </Paper>

            {/* Setup Modal */}
            <Modal
                opened={setupModalOpened}
                onClose={() => {
                    if (setupStep !== 'recovery') {
                        setupModalHandlers.close();
                        setSetupStep('qrcode');
                        setQrCodeSvg(null);
                        setSetupKey(null);
                        resetConfirm();
                    }
                }}
                title="Enable Two-Factor Authentication"
                size="md"
                closeOnClickOutside={setupStep !== 'recovery'}
                closeOnEscape={setupStep !== 'recovery'}
                withCloseButton={setupStep !== 'recovery'}
            >
                {setupStep === 'qrcode' && (
                    <Stack gap="md">
                        <Text size="sm">
                            Scan this QR code with your authenticator app
                            (Google Authenticator, 1Password, Authy, etc.).
                        </Text>

                        {qrCodeSvg && (
                            <Box
                                style={{
                                    display: 'flex',
                                    justifyContent: 'center',
                                }}
                                dangerouslySetInnerHTML={{ __html: qrCodeSvg }}
                            />
                        )}

                        {setupKey && (
                            <Stack gap="xs">
                                <Text size="sm" c="dimmed">
                                    Or enter this setup key manually:
                                </Text>
                                <Group gap="xs">
                                    <Code>{setupKey}</Code>
                                    <CopyButton value={setupKey}>
                                        {({ copied, copy }) => (
                                            <Button
                                                size="xs"
                                                variant="subtle"
                                                onClick={copy}
                                                leftSection={
                                                    copied ? (
                                                        <IconCheck size={14} />
                                                    ) : (
                                                        <IconCopy size={14} />
                                                    )
                                                }
                                            >
                                                {copied ? 'Copied' : 'Copy'}
                                            </Button>
                                        )}
                                    </CopyButton>
                                </Group>
                            </Stack>
                        )}

                        <Group justify="flex-end">
                            <Button onClick={() => setSetupStep('confirm')}>
                                Continue
                            </Button>
                        </Group>
                    </Stack>
                )}

                {setupStep === 'confirm' && (
                    <form onSubmit={handleConfirmCode}>
                        <Stack gap="md">
                            <Text size="sm">
                                Enter the 6-digit code from your authenticator
                                app to confirm setup.
                            </Text>

                            <Stack align="center" gap="xs">
                                <PinInput
                                    length={6}
                                    type="number"
                                    value={confirmData.code}
                                    onChange={(value) =>
                                        setConfirmData('code', value)
                                    }
                                    error={!!confirmErrors.code}
                                    autoFocus
                                    oneTimeCode
                                />
                                {confirmErrors.code && (
                                    <Text size="sm" c="red">
                                        {confirmErrors.code}
                                    </Text>
                                )}
                            </Stack>

                            <Group justify="flex-end">
                                <Button
                                    variant="default"
                                    onClick={() => setSetupStep('qrcode')}
                                >
                                    Back
                                </Button>
                                <Button
                                    type="submit"
                                    loading={confirmProcessing}
                                >
                                    Confirm
                                </Button>
                            </Group>
                        </Stack>
                    </form>
                )}

                {setupStep === 'recovery' && (
                    <Stack gap="md">
                        <Alert color="yellow" variant="light">
                            <Text size="sm" fw={500}>
                                Save these recovery codes in a secure location!
                            </Text>
                            <Text size="sm" mt="xs">
                                These codes can be used to recover access to
                                your account if you lose your authenticator
                                device. Each code can only be used once.
                            </Text>
                        </Alert>

                        <Paper withBorder p="md" bg="gray.0">
                            <SimpleGrid cols={2} spacing="xs">
                                {recoveryCodes.map((code) => (
                                    <Code key={code} fz="sm">
                                        {code}
                                    </Code>
                                ))}
                            </SimpleGrid>
                        </Paper>

                        <CopyButton value={recoveryCodes.join('\n')}>
                            {({ copied, copy }) => (
                                <Button
                                    variant="light"
                                    onClick={copy}
                                    leftSection={
                                        copied ? (
                                            <IconCheck size={16} />
                                        ) : (
                                            <IconCopy size={16} />
                                        )
                                    }
                                >
                                    {copied ? 'Copied!' : 'Copy all codes'}
                                </Button>
                            )}
                        </CopyButton>

                        <Button onClick={handleSetupComplete}>
                            I&apos;ve saved my recovery codes
                        </Button>
                    </Stack>
                )}
            </Modal>

            {/* Disable Modal */}
            <Modal
                opened={disableModalOpened}
                onClose={handleCloseDisableModal}
                title="Disable Two-Factor Authentication"
            >
                {showDisablePasswordPrompt ? (
                    <form onSubmit={handleDisablePasswordSubmit}>
                        <Stack gap="md">
                            <Text size="sm">
                                Please confirm your password to disable
                                two-factor authentication.
                            </Text>
                            <PasswordInput
                                label="Password"
                                value={disablePassword}
                                onChange={(e) =>
                                    setDisablePassword(e.target.value)
                                }
                                error={disablePasswordError}
                                autoFocus
                                required
                            />
                            <Group justify="flex-end">
                                <Button
                                    variant="default"
                                    onClick={handleCloseDisableModal}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    loading={disablePasswordLoading}
                                >
                                    Continue
                                </Button>
                            </Group>
                        </Stack>
                    </form>
                ) : (
                    <Stack gap="md">
                        <Alert color="yellow" variant="light">
                            Disabling two-factor authentication will make your
                            account less secure.
                        </Alert>

                        <Group justify="flex-end">
                            <Button
                                variant="default"
                                onClick={handleCloseDisableModal}
                            >
                                Cancel
                            </Button>
                            <Button
                                color="red"
                                onClick={handleDisable}
                                loading={disableProcessing}
                            >
                                Disable 2FA
                            </Button>
                        </Group>
                    </Stack>
                )}
            </Modal>

            {/* Recovery Codes Modal */}
            <Modal
                opened={recoveryModalOpened}
                onClose={handleCloseRecoveryModal}
                title="Recovery Codes"
                size="md"
            >
                {showRecoveryPasswordPrompt ? (
                    <form onSubmit={handleRecoveryPasswordSubmit}>
                        <Stack gap="md">
                            <Text size="sm">
                                Please confirm your password to view recovery
                                codes.
                            </Text>
                            <PasswordInput
                                label="Password"
                                value={recoveryPassword}
                                onChange={(e) =>
                                    setRecoveryPassword(e.target.value)
                                }
                                error={recoveryPasswordError}
                                autoFocus
                                required
                            />
                            <Group justify="flex-end">
                                <Button
                                    variant="default"
                                    onClick={handleCloseRecoveryModal}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    loading={recoveryPasswordLoading}
                                >
                                    Continue
                                </Button>
                            </Group>
                        </Stack>
                    </form>
                ) : (
                    <Stack gap="md">
                        <Alert color="yellow" variant="light">
                            <Text size="sm">
                                Store these recovery codes in a secure location.
                                They can be used to access your account if you
                                lose your authenticator device.
                            </Text>
                        </Alert>

                        <Paper withBorder p="md" bg="gray.0">
                            <SimpleGrid cols={2} spacing="xs">
                                {recoveryCodes.map((code) => (
                                    <Code key={code} fz="sm">
                                        {code}
                                    </Code>
                                ))}
                            </SimpleGrid>
                        </Paper>

                        <Group gap="sm">
                            <CopyButton value={recoveryCodes.join('\n')}>
                                {({ copied, copy }) => (
                                    <Button
                                        variant="light"
                                        onClick={copy}
                                        leftSection={
                                            copied ? (
                                                <IconCheck size={16} />
                                            ) : (
                                                <IconCopy size={16} />
                                            )
                                        }
                                    >
                                        {copied ? 'Copied!' : 'Copy all'}
                                    </Button>
                                )}
                            </CopyButton>
                            <Button
                                variant="light"
                                color="orange"
                                onClick={handleRegenerateRecoveryCodes}
                            >
                                Regenerate Codes
                            </Button>
                        </Group>
                    </Stack>
                )}
            </Modal>
        </Stack>
    );
};

export default TwoFactorSettings;
