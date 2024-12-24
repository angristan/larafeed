import { Head, Link } from '@inertiajs/react';
import { Container, Stack } from '@mantine/core';

export default function Welcome() {
    return (
        <>
            <Head title="Welcome" />
            <Container>
                <h1>Welcome to Larafeed</h1>
                <Stack>
                    <Link href="/login">Login</Link>
                    <Link href="/register">Create an account</Link>
                </Stack>
            </Container>
        </>
    );
}
