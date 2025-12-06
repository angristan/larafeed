import { Head, router, useForm } from '@inertiajs/react';
import {
    Anchor,
    Button,
    Container,
    Paper,
    PasswordInput,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import classes from './Register.module.css';

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
        <Container size={420} my={40}>
            <Head title="Register" />

            <Title ta="center" className={classes.title}>
                Create account
            </Title>
            <Text c="dimmed" size="sm" ta="center" mt={5}>
                Already have an account?{' '}
                <Anchor
                    component="a"
                    onClick={() => router.visit(route('login'))}
                    size="sm"
                >
                    Sign in
                </Anchor>
            </Text>

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
                    label="Name"
                    placeholder="Your name"
                    required
                    value={data.name}
                    onChange={(e) => setData('name', e.target.value)}
                    error={errors.name}
                    autoComplete="name"
                />

                <TextInput
                    label="Email"
                    placeholder="you@example.com"
                    required
                    mt="md"
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
                    autoComplete="new-password"
                />

                <PasswordInput
                    label="Confirm Password"
                    placeholder="Confirm your password"
                    required
                    mt="md"
                    value={data.password_confirmation}
                    onChange={(e) =>
                        setData('password_confirmation', e.target.value)
                    }
                    error={errors.password_confirmation}
                    autoComplete="new-password"
                />

                <Button fullWidth mt="xl" type="submit" loading={processing}>
                    Register
                </Button>
            </Paper>
        </Container>
    );
}
