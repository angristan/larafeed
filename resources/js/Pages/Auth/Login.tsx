import { Head, Link, useForm } from '@inertiajs/react';
import {
    Alert,
    Anchor,
    Button,
    Checkbox,
    Group,
    PasswordInput,
    Stack,
    TextInput,
} from '@mantine/core';
import { IconLogin2 } from '@tabler/icons-react';
import AuthLayout from '@/Layouts/AuthLayout/AuthLayout';

interface Props {
    status?: string;
    canResetPassword: boolean;
    canRegister: boolean;
}

export default function Login({
    status,
    canResetPassword,
    canRegister,
}: Props) {
    const { data, setData, post, processing, errors, reset } = useForm({
        email: '',
        password: '',
        remember: false as boolean,
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        post(route('login'), {
            onFinish: () => reset('password'),
        });
    };

    return (
        <AuthLayout
            title="Welcome back"
            description="Sign in to pick up your reading queue where you left it."
            icon={<IconLogin2 size={22} stroke={1.7} />}
            footer={
                canRegister ? (
                    <>
                        New to Larafeed?{' '}
                        <Anchor
                            component={Link}
                            href={route('register')}
                            fw={600}
                        >
                            Create an account
                        </Anchor>
                    </>
                ) : undefined
            }
        >
            <Head title="Log in" />

            <form onSubmit={handleSubmit}>
                <Stack gap="md">
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
                        value={data.email}
                        onChange={(event) =>
                            setData('email', event.currentTarget.value)
                        }
                        error={errors.email}
                        autoComplete="username"
                    />

                    <PasswordInput
                        label="Password"
                        placeholder="Your password"
                        name="password"
                        required
                        value={data.password}
                        onChange={(event) =>
                            setData('password', event.currentTarget.value)
                        }
                        error={errors.password}
                        autoComplete="current-password"
                    />

                    <Group justify="space-between" wrap="wrap" gap="sm">
                        <Checkbox
                            label="Remember me"
                            checked={data.remember}
                            onChange={(event) =>
                                setData('remember', event.currentTarget.checked)
                            }
                        />
                        {canResetPassword && (
                            <Anchor
                                component={Link}
                                href={route('password.request')}
                                size="sm"
                                fw={500}
                            >
                                Forgot password?
                            </Anchor>
                        )}
                    </Group>

                    <Button
                        fullWidth
                        size="md"
                        type="submit"
                        loading={processing}
                        disabled={processing}
                    >
                        Sign in
                    </Button>
                </Stack>
            </form>
        </AuthLayout>
    );
}
