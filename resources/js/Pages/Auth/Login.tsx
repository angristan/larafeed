import { Head, router, useForm } from '@inertiajs/react';
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
import classes from './Login.module.css';

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
    const form = useForm({
        email: '',
        password: '',
        remember: false as boolean,
    }).withPrecognition('post', route('login'));

    const { data, setData, post, processing, errors, reset, validate } = form;

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
            {canRegister && (
                <Text c="dimmed" size="sm" ta="center" mt={5}>
                    Do not have an account yet?{' '}
                    <Anchor
                        size="sm"
                        onClick={() => router.visit(route('register'))}
                    >
                        Create account
                    </Anchor>
                </Text>
            )}

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
                    onBlur={() => validate('email')}
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
                    onBlur={() => validate('password')}
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
