import {
    Alert,
    Badge,
    Group,
    Paper,
    Stack,
    Text,
    ThemeIcon,
    Title,
} from '@mantine/core';
import {
    IconClock,
    IconShieldCheck,
    IconShieldExclamation,
    IconShieldLock,
} from '@tabler/icons-react';

interface TwoFactorSettingsProps {
    twoFactorEnabled: boolean;
    twoFactorConfirmed: boolean;
}

const TwoFactorSettings = ({
    twoFactorEnabled,
    twoFactorConfirmed,
}: TwoFactorSettingsProps) => {
    const isFullyEnabled = twoFactorEnabled && twoFactorConfirmed;
    const isSetupIncomplete = twoFactorEnabled && !twoFactorConfirmed;

    return (
        <Stack gap="xl">
            <Stack gap={4}>
                <Group gap="sm">
                    <Title order={2}>Two-factor authentication</Title>
                    {isFullyEnabled ? (
                        <Badge
                            color="green"
                            leftSection={<IconShieldCheck size={12} />}
                        >
                            Enabled
                        </Badge>
                    ) : isSetupIncomplete ? (
                        <Badge
                            color="yellow"
                            leftSection={<IconShieldExclamation size={12} />}
                        >
                            Setup incomplete
                        </Badge>
                    ) : (
                        <Badge
                            color="gray"
                            leftSection={<IconClock size={12} />}
                        >
                            Coming later
                        </Badge>
                    )}
                </Group>
                <Text size="sm" c="dimmed">
                    Add an extra layer of protection with an authenticator app
                    and one-time recovery codes.
                </Text>
            </Stack>

            <Paper withBorder p="lg" radius="md" maw={560}>
                <Stack gap="md">
                    <Group gap="sm" wrap="nowrap" align="flex-start">
                        <ThemeIcon
                            size={42}
                            radius="xl"
                            variant="light"
                            color={
                                isFullyEnabled
                                    ? 'green'
                                    : isSetupIncomplete
                                      ? 'yellow'
                                      : 'blue'
                            }
                        >
                            {isFullyEnabled ? (
                                <IconShieldCheck size={22} stroke={1.6} />
                            ) : isSetupIncomplete ? (
                                <IconShieldExclamation size={22} stroke={1.6} />
                            ) : (
                                <IconShieldLock size={22} stroke={1.6} />
                            )}
                        </ThemeIcon>
                        <Stack gap={3}>
                            <Text fw={700}>
                                {isFullyEnabled
                                    ? 'Your account is protected by 2FA'
                                    : isSetupIncomplete
                                      ? 'Your 2FA setup needs attention'
                                      : 'Self-service setup is not available yet'}
                            </Text>
                            <Text size="sm" c="dimmed">
                                {isFullyEnabled
                                    ? 'Larafeed will continue asking for an authenticator or recovery code when you sign in.'
                                    : isSetupIncomplete
                                      ? 'A two-factor secret exists for this account, but setup has not been confirmed.'
                                      : 'Two-factor management is planned, but it is not wired up in this version of Larafeed.'}
                            </Text>
                        </Stack>
                    </Group>

                    <Alert
                        color={isSetupIncomplete ? 'yellow' : 'blue'}
                        variant="light"
                        title={
                            isFullyEnabled
                                ? 'Management tools are temporarily unavailable'
                                : isSetupIncomplete
                                  ? 'Do not sign out until this is resolved'
                                  : 'No account changes were made'
                        }
                    >
                        {isFullyEnabled
                            ? 'Recovery-code viewing, regeneration, and disabling 2FA are not available from this screen yet.'
                            : isSetupIncomplete
                              ? 'This screen cannot resume or reset the setup. Contact the Larafeed administrator for help.'
                              : 'Enablement controls will appear here once the supporting server endpoints are available.'}
                    </Alert>
                </Stack>
            </Paper>
        </Stack>
    );
};

export default TwoFactorSettings;
