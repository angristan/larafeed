import { Head, Link } from '@inertiajs/react';
import { Container } from '@mantine/core';

export default function Welcome() {
    return (
        <>
            <Head title="Welcome" />
            <Container>
                <h1>Welcome to Larafeed</h1>
                <p>
                    <Link href="/login">Login</Link>
                </p>
            </Container>
        </>
    );
}
