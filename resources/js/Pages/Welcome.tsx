import { Head, Link } from '@inertiajs/react';
import { Container, Stack } from '@mantine/core';

interface Props {
    canRegister: boolean;
}

export default function Welcome({ canRegister }: Props) {
    return (
        <>
            <Head title="Welcome" />
            <Container>
                <h1>Welcome to Larafeed</h1>
                <Stack>
                    <Link href="/login">Login</Link>
                    {canRegister ? (
                        <Link href="/register">Create an account</Link>
                    ) : (
                        <span>You can't register right now.</span>
                    )}
                </Stack>
            </Container>
        </>
    );
}
