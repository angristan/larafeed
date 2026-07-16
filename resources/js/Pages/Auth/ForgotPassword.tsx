import { Head, Link, useForm } from '@inertiajs/react';
import { Alert, Anchor, Button, Stack, TextInput } from '@mantine/core';
import { IconKey } from '@tabler/icons-react';
import type { FormEventHandler } from 'react';
import AuthLayout from '@/Layouts/AuthLayout/AuthLayout';

export default function ForgotPassword({ status }: { status?: string }) {
    const { data, setData, post, processing, errors } = useForm({
        email: '',
    });

    const submit: FormEventHandler = (e) => {
        e.preventDefault();

        post(route('password.email'));
    };

    return (
        <AuthLayout
            title="Reset your password"
            description="Enter your email and we will send you a secure reset link."
            icon={<IconKey size={22} stroke={1.7} />}
            footer={
                <Anchor component={Link} href={route('login')} fw={600}>
                    Back to sign in
                </Anchor>
            }
        >
            <Head title="Forgot Password" />

            <form onSubmit={submit}>
                <Stack gap="lg">
                    {status && (
                        <Alert color="green" role="status">
                            {status}
                        </Alert>
                    )}

                    <TextInput
                        label="Email"
                        placeholder="you@example.com"
                        name="email"
                        type="email"
                        required
                        autoFocus
                        autoComplete="username"
                        value={data.email}
                        onChange={(event) =>
                            setData('email', event.currentTarget.value)
                        }
                        error={errors.email}
                    />

                    <Button
                        fullWidth
                        size="md"
                        type="submit"
                        loading={processing}
                        disabled={processing}
                    >
                        Send reset link
                    </Button>
                </Stack>
            </form>
        </AuthLayout>
    );
}
