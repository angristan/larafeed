import { Link, useForm, usePage } from '@inertiajs/react';
import {
    Alert,
    Button,
    Group,
    Modal,
    PasswordInput,
    Stack,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle, IconMail, IconTrash } from '@tabler/icons-react';
import { type FormEventHandler, useRef } from 'react';
import type { PageProps } from '@/types';

interface ProfileSettingsProps {
    mustVerifyEmail: boolean;
    status?: string;
}

const ProfileSettings = ({ mustVerifyEmail, status }: ProfileSettingsProps) => {
    const {
        props: {
            auth: { user },
        },
    } = usePage<PageProps>();

    const profileForm = useForm({
        name: user.name,
        email: user.email,
    }).withPrecognition('patch', route('profile.update'));

    const {
        data,
        setData,
        patch,
        errors,
        processing,
        recentlySuccessful,
        validate,
    } = profileForm;

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

    const passwordForm = useForm({
        current_password: '',
        password: '',
        password_confirmation: '',
    }).withPrecognition('put', route('password.update'));

    const {
        data: passwordData,
        setData: setPasswordData,
        put,
        errors: passwordErrors,
        processing: passwordProcessing,
        reset: resetPassword,
        validate: validatePassword,
    } = passwordForm;

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
    const deleteForm = useForm({
        password: '',
    }).withPrecognition('delete', route('profile.destroy'));

    const {
        data: deleteData,
        setData: setDeleteData,
        delete: destroy,
        processing: deleteProcessing,
        errors: deleteErrors,
        reset: resetDelete,
        validate: validateDelete,
    } = deleteForm;

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
                    onBlur={() => validate('name')}
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
                    onBlur={() => validate('email')}
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
                    onBlur={() => validatePassword('current_password')}
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
                    onBlur={() => validatePassword('password')}
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
                    onBlur={() => validatePassword('password_confirmation')}
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
                            onBlur={() => validateDelete('password')}
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

export default ProfileSettings;
