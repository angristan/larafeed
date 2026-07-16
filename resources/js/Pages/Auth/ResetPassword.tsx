import { Head, useForm } from '@inertiajs/react';
import { Button, PasswordInput, Stack, TextInput } from '@mantine/core';
import { IconKey } from '@tabler/icons-react';
import type { FormEventHandler } from 'react';
import AuthLayout from '@/Layouts/AuthLayout/AuthLayout';

export default function ResetPassword({
    token,
    email,
}: {
    token: string;
    email: string;
}) {
    const { data, setData, post, processing, errors, reset } = useForm({
        token: token,
        email: email,
        password: '',
        password_confirmation: '',
    });

    const submit: FormEventHandler = (e) => {
        e.preventDefault();

        post(route('password.store'), {
            onFinish: () => reset('password', 'password_confirmation'),
        });
    };

    return (
        <AuthLayout
            title="Choose a new password"
            description="Use a unique password with at least 8 characters."
            icon={<IconKey size={22} stroke={1.7} />}
        >
            <Head title="Reset Password" />

            <form onSubmit={submit}>
                <Stack gap="md">
                    <TextInput
                        label="Email"
                        placeholder="you@example.com"
                        name="email"
                        type="email"
                        required
                        autoComplete="username"
                        value={data.email}
                        onChange={(event) =>
                            setData('email', event.currentTarget.value)
                        }
                        error={errors.email}
                    />

                    <PasswordInput
                        label="New password"
                        description="Use at least 8 characters"
                        placeholder="Create a new password"
                        name="password"
                        required
                        minLength={8}
                        autoFocus
                        autoComplete="new-password"
                        value={data.password}
                        onChange={(event) =>
                            setData('password', event.currentTarget.value)
                        }
                        error={errors.password}
                    />

                    <PasswordInput
                        label="Confirm new password"
                        placeholder="Repeat your new password"
                        name="password_confirmation"
                        required
                        minLength={8}
                        autoComplete="new-password"
                        value={data.password_confirmation}
                        onChange={(event) =>
                            setData(
                                'password_confirmation',
                                event.currentTarget.value,
                            )
                        }
                        error={errors.password_confirmation}
                    />

                    <Button
                        fullWidth
                        size="md"
                        type="submit"
                        loading={processing}
                        disabled={processing}
                    >
                        Reset password
                    </Button>
                </Stack>
            </form>
        </AuthLayout>
    );
}
