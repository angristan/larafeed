import classes from './Login.module.css';

import { useForm } from '@inertiajs/react';
import { Head } from '@inertiajs/react';
import {
    Alert,
    Anchor,
    Button,
    Checkbox,
    Container,
    Group,
    Paper,
    PasswordInput,
    Text,
    TextInput,
    Title,
} from '@mantine/core';

interface Props {
    status?: string;
    canResetPassword: boolean;
}

export default function Login({ status, canResetPassword }: Props) {
    const { data, setData, post, processing, errors, reset } = useForm({
        email: '',
        password: '',
        remember: false,
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        post(route('login'), {
            onFinish: () => reset('password'),
        });
    };

    return (
        <Container size={420} my={40}>
            <Head title="Log in" />

            <Title ta="center" className={classes.title}>
                Welcome back!
            </Title>
            <Text c="dimmed" size="sm" ta="center" mt={5}>
                Do not have an account yet?{' '}
                <Anchor component="button" size="sm">
                    Create account
                </Anchor>
            </Text>

            {status && (
                <Alert color="green" mt="md">
                    {status}
                </Alert>
            )}

            <Paper
                withBorder
                shadow="md"
                p={30}
                mt={30}
                radius="md"
                component="form"
                onSubmit={handleSubmit}
            >
                <TextInput
                    label="Email"
                    placeholder="you@mantine.dev"
                    required
                    value={data.email}
                    onChange={(e) => setData('email', e.target.value)}
                    error={errors.email}
                    autoComplete="username"
                />

                <PasswordInput
                    label="Password"
                    placeholder="Your password"
                    required
                    mt="md"
                    value={data.password}
                    onChange={(e) => setData('password', e.target.value)}
                    error={errors.password}
                    autoComplete="current-password"
                />

                <Group justify="space-between" mt="lg">
                    <Checkbox
                        label="Remember me"
                        checked={data.remember}
                        onChange={(e) => setData('remember', e.target.checked)}
                    />
                    {canResetPassword && (
                        <Anchor
                            component="a"
                            href={route('password.request')}
                            size="sm"
                        >
                            Forgot password?
                        </Anchor>
                    )}
                </Group>

                <Group mt="xl" gap="sm">
                    <Button fullWidth type="submit" loading={processing}>
                        Sign in
                    </Button>
                    {window.location.hostname === 'localhost' && (
                        <Anchor
                            component="a"
                            href={route('loginLinkLogin')}
                            onClick={(e) => {
                                e.preventDefault();
                                post(route('loginLinkLogin'));
                            }}
                        >
                            Quick Login
                        </Anchor>
                    )}
                </Group>
            </Paper>
        </Container>
    );
}
