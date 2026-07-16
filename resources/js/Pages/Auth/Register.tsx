import { Head, Link, useForm } from '@inertiajs/react';
import { Anchor, Button, PasswordInput, Stack, TextInput } from '@mantine/core';
import { IconUserPlus } from '@tabler/icons-react';
import AuthLayout from '@/Layouts/AuthLayout/AuthLayout';

export default function Register() {
    const { data, setData, post, processing, errors, reset } = useForm({
        name: '',
        email: '',
        password: '',
        password_confirmation: '',
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        post(route('register'), {
            onFinish: () => reset('password', 'password_confirmation'),
        });
    };

    return (
        <AuthLayout
            title="Create your account"
            description="Set up a focused home for the feeds you care about."
            icon={<IconUserPlus size={22} stroke={1.7} />}
            footer={
                <>
                    Already have an account?{' '}
                    <Anchor component={Link} href={route('login')} fw={600}>
                        Sign in
                    </Anchor>
                </>
            }
        >
            <Head title="Register" />

            <form onSubmit={handleSubmit}>
                <Stack gap="md">
                    <TextInput
                        label="Name"
                        placeholder="Your name"
                        name="name"
                        required
                        autoFocus
                        value={data.name}
                        onChange={(event) =>
                            setData('name', event.currentTarget.value)
                        }
                        error={errors.name}
                        autoComplete="name"
                    />

                    <TextInput
                        label="Email"
                        placeholder="you@example.com"
                        name="email"
                        type="email"
                        required
                        value={data.email}
                        onChange={(event) =>
                            setData('email', event.currentTarget.value)
                        }
                        error={errors.email}
                        autoComplete="username"
                    />

                    <PasswordInput
                        label="Password"
                        description="Use at least 8 characters"
                        placeholder="Create a password"
                        name="password"
                        required
                        minLength={8}
                        value={data.password}
                        onChange={(event) =>
                            setData('password', event.currentTarget.value)
                        }
                        error={errors.password}
                        autoComplete="new-password"
                    />

                    <PasswordInput
                        label="Confirm password"
                        placeholder="Repeat your password"
                        name="password_confirmation"
                        required
                        minLength={8}
                        value={data.password_confirmation}
                        onChange={(event) =>
                            setData(
                                'password_confirmation',
                                event.currentTarget.value,
                            )
                        }
                        error={errors.password_confirmation}
                        autoComplete="new-password"
                    />

                    <Button
                        fullWidth
                        size="md"
                        type="submit"
                        loading={processing}
                        disabled={processing}
                    >
                        Create account
                    </Button>
                </Stack>
            </form>
        </AuthLayout>
    );
}
