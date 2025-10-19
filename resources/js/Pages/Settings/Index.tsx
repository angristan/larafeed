import AppShellLayout from '@/Layouts/AppShellLayout/AppShellLayout';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { PageProps } from '@/types';
import { Link, router, useForm, usePage } from '@inertiajs/react';
import {
    Alert,
    AppShell,
    Button,
    FileInput,
    Group,
    Modal,
    NavLink,
    PasswordInput,
    Stack,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
    IconAlertCircle,
    IconFileImport,
    IconMail,
    IconTrash,
    IconUserCircle,
} from '@tabler/icons-react';
import { FormEventHandler, ReactNode, useMemo, useRef, useState } from 'react';

type SettingsSection = 'profile' | 'opml';

type SettingsPageProps = PageProps<{
    mustVerifyEmail: boolean;
    status?: string;
    initialSection?: SettingsSection;
}>;

const SettingsSidebar = ({
    activeSection,
    onSelect,
}: {
    activeSection: SettingsSection;
    onSelect: (section: SettingsSection) => void;
}) => (
    <AppShell.Navbar>
        <AppShell.Section p="md" pb="xs">
            <Text size="xs" c="dimmed" fw={500} tt="uppercase">
                Settings
            </Text>
        </AppShell.Section>
        <AppShell.Section px="md" pb="md">
            <Stack gap={4}>
                <NavLink
                    component="button"
                    type="button"
                    onClick={() => onSelect('profile')}
                    active={activeSection === 'profile'}
                    label="Profile"
                    description="Account details & password"
                    leftSection={<IconUserCircle size={16} stroke={1.5} />}
                />
                <NavLink
                    component="button"
                    type="button"
                    onClick={() => onSelect('opml')}
                    active={activeSection === 'opml'}
                    label="Import & export"
                    description="OPML and data tools"
                    leftSection={<IconFileImport size={16} stroke={1.5} />}
                />
            </Stack>
        </AppShell.Section>
    </AppShell.Navbar>
);

const ProfileSettings = ({
    mustVerifyEmail,
    status,
}: {
    mustVerifyEmail: boolean;
    status?: string;
}) => {
    const {
        props: {
            auth: { user },
        },
    } = usePage<PageProps>();

    const { data, setData, patch, errors, processing, recentlySuccessful } =
        useForm({
            name: user.name,
            email: user.email,
        });

    const submitProfile: FormEventHandler = (event) => {
        event.preventDefault();

        patch(route('profile.update'), {
            preserveScroll: true,
            onSuccess: () => {
                notifications.show({
                    title: 'Profile updated',
                    message: 'Your account information was saved.',
                    color: 'green',
                });
            },
        });
    };

    const {
        data: passwordData,
        setData: setPasswordData,
        put,
        errors: passwordErrors,
        processing: passwordProcessing,
        reset: resetPassword,
    } = useForm({
        current_password: '',
        password: '',
        password_confirmation: '',
    });

    const passwordInputRef = useRef<HTMLInputElement>(null);
    const currentPasswordInputRef = useRef<HTMLInputElement>(null);

    const submitPassword: FormEventHandler = (event) => {
        event.preventDefault();

        put(route('password.update'), {
            preserveScroll: true,
            onSuccess: () => {
                notifications.show({
                    title: 'Password updated',
                    message: 'Your password has been changed.',
                    color: 'green',
                });
                resetPassword();
            },
            onError: (formErrors) => {
                if (formErrors.password) {
                    passwordInputRef.current?.focus();
                }
                if (formErrors.current_password) {
                    currentPasswordInputRef.current?.focus();
                }
            },
        });
    };

    const [deleteModalOpened, deleteModalHandlers] = useDisclosure(false);
    const deletePasswordRef = useRef<HTMLInputElement>(null);
    const {
        data: deleteData,
        setData: setDeleteData,
        delete: destroy,
        processing: deleteProcessing,
        errors: deleteErrors,
        reset: resetDelete,
    } = useForm({
        password: '',
    });

    const confirmDeletion: FormEventHandler = (event) => {
        event.preventDefault();

        destroy(route('profile.destroy'), {
            preserveScroll: true,
            onFinish: () => resetDelete(),
            onError: () => deletePasswordRef.current?.focus(),
        });
    };

    const closeDeleteModal = () => {
        deleteModalHandlers.close();
        resetDelete();
    };

    return (
        <Stack gap="xl">
            <Stack gap={4}>
                <Title order={2}>Profile settings</Title>
                <Text size="sm" c="dimmed">
                    Update your account information, password, or delete your
                    account.
                </Text>
            </Stack>

            <Stack component="form" onSubmit={submitProfile} gap="md" maw={520}>
                <Title order={3}>Account details</Title>
                <TextInput
                    label="Name"
                    value={data.name}
                    onChange={(event) =>
                        setData('name', event.currentTarget.value)
                    }
                    required
                    error={errors.name}
                    data-autofocus
                />
                <TextInput
                    label="Email"
                    value={data.email}
                    type="email"
                    onChange={(event) =>
                        setData('email', event.currentTarget.value)
                    }
                    required
                    error={errors.email}
                />

                {mustVerifyEmail && user.email_verified_at === null && (
                    <Alert
                        icon={<IconMail size={16} />}
                        color="yellow"
                        variant="light"
                    >
                        <Stack gap={6}>
                            <Text size="sm">
                                Your email address is unverified. We can resend
                                the verification email if needed.
                            </Text>
                            <Group gap="xs">
                                <Button
                                    component={Link}
                                    href={route('verification.send')}
                                    method="post"
                                    variant="light"
                                    size="xs"
                                >
                                    Resend verification email
                                </Button>
                                {status === 'verification-link-sent' && (
                                    <Text size="sm" c="dimmed">
                                        We sent a new verification link to{' '}
                                        {data.email}.
                                    </Text>
                                )}
                            </Group>
                        </Stack>
                    </Alert>
                )}

                <Group justify="flex-end">
                    <Button type="submit" loading={processing}>
                        Save changes
                    </Button>
                </Group>

                {recentlySuccessful && (
                    <Text size="sm" c="dimmed">
                        Changes saved successfully.
                    </Text>
                )}
            </Stack>

            <Stack
                component="form"
                onSubmit={submitPassword}
                gap="md"
                maw={520}
            >
                <Title order={3}>Password</Title>
                <PasswordInput
                    label="Current password"
                    value={passwordData.current_password}
                    onChange={(event) =>
                        setPasswordData(
                            'current_password',
                            event.currentTarget.value,
                        )
                    }
                    error={passwordErrors.current_password}
                    ref={currentPasswordInputRef}
                    required
                />
                <PasswordInput
                    label="New password"
                    value={passwordData.password}
                    onChange={(event) =>
                        setPasswordData('password', event.currentTarget.value)
                    }
                    error={passwordErrors.password}
                    ref={passwordInputRef}
                    required
                />
                <PasswordInput
                    label="Confirm new password"
                    value={passwordData.password_confirmation}
                    onChange={(event) =>
                        setPasswordData(
                            'password_confirmation',
                            event.currentTarget.value,
                        )
                    }
                    error={passwordErrors.password_confirmation}
                    required
                />
                <Group justify="flex-end">
                    <Button type="submit" loading={passwordProcessing}>
                        Update password
                    </Button>
                </Group>
            </Stack>

            <Stack gap="md" maw={520}>
                <Title order={3}>Delete account</Title>
                <Alert
                    icon={<IconAlertCircle size={16} />}
                    color="red"
                    variant="light"
                >
                    Once deleted, all of your feeds, entries, and categories are
                    removed permanently.
                </Alert>
                <Group justify="space-between">
                    <Text size="sm" c="dimmed">
                        This action cannot be undone.
                    </Text>
                    <Button
                        color="red"
                        leftSection={<IconTrash size={16} />}
                        onClick={deleteModalHandlers.open}
                    >
                        Delete account
                    </Button>
                </Group>
            </Stack>

            <Modal
                opened={deleteModalOpened}
                onClose={closeDeleteModal}
                title="Delete account"
            >
                <form onSubmit={confirmDeletion}>
                    <Stack gap="md">
                        <Text>
                            Please confirm your password to permanently delete
                            your account.
                        </Text>
                        <PasswordInput
                            label="Password"
                            value={deleteData.password}
                            onChange={(event) =>
                                setDeleteData(
                                    'password',
                                    event.currentTarget.value,
                                )
                            }
                            error={deleteErrors.password}
                            ref={deletePasswordRef}
                            required
                        />
                        <Group justify="flex-end">
                            <Button
                                variant="default"
                                onClick={closeDeleteModal}
                            >
                                Cancel
                            </Button>
                            <Button
                                color="red"
                                type="submit"
                                loading={deleteProcessing}
                            >
                                Permanently delete
                            </Button>
                        </Group>
                    </Stack>
                </form>
            </Modal>
        </Stack>
    );
};

const OpmlSettings = () => {
    const { data, setData, post, processing, errors, reset } = useForm({
        opml_file: null as File | null,
    });

    const submitImport: FormEventHandler = (event) => {
        event.preventDefault();

        post(route('import.store'), {
            forceFormData: true,
            preserveScroll: true,
            onSuccess: () => {
                notifications.show({
                    title: 'OPML uploaded',
                    message: 'Feeds will import in the background shortly.',
                    color: 'green',
                });
                reset();
            },
        });
    };

    const [wipeModalOpened, wipeModalHandlers] = useDisclosure(false);
    const [wiping, setWiping] = useState(false);

    const handleWipe = () => {
        setWiping(true);
        router.post(
            route('profile.wipe'),
            {},
            {
                preserveScroll: true,
                onSuccess: () => {
                    notifications.show({
                        title: 'Account wiped',
                        message:
                            'All feeds, entries, and categories were deleted.',
                        color: 'orange',
                    });
                    wipeModalHandlers.close();
                },
                onFinish: () => setWiping(false),
            },
        );
    };

    return (
        <Stack gap="xl">
            <Stack gap={4}>
                <Title order={2}>Import & export</Title>
                <Text size="sm" c="dimmed">
                    Manage OPML files and reset your reading data.
                </Text>
            </Stack>

            <Stack component="form" onSubmit={submitImport} gap="md" maw={520}>
                <Title order={3}>Import OPML</Title>
                <FileInput
                    label="Upload OPML file"
                    placeholder="Select or drop an .opml file"
                    accept=".opml"
                    value={data.opml_file}
                    onChange={(file) => setData('opml_file', file)}
                    clearable
                    error={errors.opml_file}
                    required
                />
                <Group justify="flex-end">
                    <Button
                        type="submit"
                        loading={processing}
                        leftSection={<IconFileImport size={16} />}
                        disabled={data.opml_file === null}
                    >
                        Import subscriptions
                    </Button>
                </Group>
            </Stack>

            <Stack gap="md" maw={520}>
                <Title order={3}>Export OPML</Title>
                <Text size="sm" c="dimmed">
                    Download all of your subscriptions as an OPML file.
                </Text>
                <Group justify="flex-start">
                    <Button
                        component="a"
                        href={route('export.download')}
                        leftSection={<IconFileImport size={16} />}
                        variant="default"
                    >
                        Download OPML
                    </Button>
                </Group>
            </Stack>

            <Stack gap="md" maw={520}>
                <Title order={3}>Wipe account data</Title>
                <Alert
                    icon={<IconAlertCircle size={16} />}
                    color="red"
                    variant="light"
                >
                    This removes all feeds, entries, and categories but keeps
                    your account active.
                </Alert>
                <Group justify="space-between">
                    <Text size="sm" c="dimmed">
                        Use when you want a clean slate without deleting your
                        account.
                    </Text>
                    <Button
                        color="red"
                        leftSection={<IconTrash size={16} />}
                        onClick={wipeModalHandlers.open}
                    >
                        Wipe data
                    </Button>
                </Group>
            </Stack>

            <Modal
                opened={wipeModalOpened}
                onClose={wipeModalHandlers.close}
                title="Wipe account data"
            >
                <Stack gap="md">
                    <Text>
                        Are you sure you want to delete all stored feeds,
                        entries, and categories? This cannot be undone.
                    </Text>
                    <Group justify="flex-end">
                        <Button
                            variant="default"
                            onClick={wipeModalHandlers.close}
                        >
                            Cancel
                        </Button>
                        <Button
                            color="red"
                            onClick={handleWipe}
                            loading={wiping}
                        >
                            Wipe data
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </Stack>
    );
};

const Settings = ({
    mustVerifyEmail,
    status,
    initialSection = 'profile',
}: SettingsPageProps) => {
    const [section, setSection] = useState<SettingsSection>(initialSection);

    const content = useMemo(() => {
        if (section === 'opml') {
            return <OpmlSettings />;
        }

        return (
            <ProfileSettings
                mustVerifyEmail={mustVerifyEmail}
                status={status}
            />
        );
    }, [section, mustVerifyEmail, status]);

    return (
        <AppShellLayout
            activePage="settings"
            sidebar={
                <SettingsSidebar
                    activeSection={section}
                    onSelect={setSection}
                />
            }
        >
            <AppShell.Main>
                <Stack gap="xl" maw={720} mx="auto" my="md">
                    <Stack gap={4}>
                        <Title order={1}>Settings</Title>
                        <Text size="sm" c="dimmed">
                            Manage your account, preferences, and data
                            import/export tools.
                        </Text>
                    </Stack>

                    {content}
                </Stack>
            </AppShell.Main>
        </AppShellLayout>
    );
};

Settings.layout = (page: ReactNode) => (
    <AuthenticatedLayout pageTitle="Settings">{page}</AuthenticatedLayout>
);

export default Settings;
