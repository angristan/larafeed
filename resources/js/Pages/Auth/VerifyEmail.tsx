import { Head, Link, useForm } from '@inertiajs/react';
import { Alert, Button, Stack, Text } from '@mantine/core';
import { IconMail } from '@tabler/icons-react';
import type { FormEventHandler } from 'react';
import AuthLayout from '@/Layouts/AuthLayout/AuthLayout';

export default function VerifyEmail({ status }: { status?: string }) {
    const { post, processing } = useForm({});

    const submit: FormEventHandler = (e) => {
        e.preventDefault();

        post(route('verification.send'));
    };

    return (
        <AuthLayout
            title="Verify your email"
            description="Open the link we sent to finish setting up your account."
            icon={<IconMail size={22} stroke={1.7} />}
        >
            <Head title="Email Verification" />

            <form onSubmit={submit}>
                <Stack gap="md">
                    {status === 'verification-link-sent' && (
                        <Alert color="green" role="status">
                            A new verification link has been sent to your email
                            address.
                        </Alert>
                    )}

                    <Text size="sm" c="dimmed" ta="center">
                        Did not receive it? Check your spam folder or request a
                        fresh message below.
                    </Text>

                    <Button
                        fullWidth
                        size="md"
                        type="submit"
                        loading={processing}
                        disabled={processing}
                    >
                        Resend verification email
                    </Button>

                    <Button
                        component={Link}
                        href={route('logout')}
                        method="post"
                        variant="default"
                        fullWidth
                    >
                        Log out
                    </Button>
                </Stack>
            </form>
        </AuthLayout>
    );
}
