import { Head, Link } from '@inertiajs/react';
import { Button, Container, Stack, Text, Title } from '@mantine/core';

interface Props {
    status: number;
}

const titles: Record<number, string> = {
    403: 'Forbidden',
    404: 'Page Not Found',
    500: 'Server Error',
};

const descriptions: Record<number, string> = {
    403: "You don't have permission to access this page.",
    404: "The page you're looking for doesn't exist or has been moved.",
    500: 'Something went wrong on our end. Please try again later.',
};

export default function ErrorPage({ status }: Props) {
    const title = titles[status] ?? 'Error';
    const description = descriptions[status] ?? 'An unexpected error occurred.';

    return (
        <>
            <Head title={title} />
            <Container size="xs" py="xl">
                <Stack align="center" gap="md" mt={80}>
                    <Text fz={120} fw={900} lh={1} c="dimmed">
                        {status}
                    </Text>
                    <Title order={2} ta="center">
                        {title}
                    </Title>
                    <Text c="dimmed" ta="center">
                        {description}
                    </Text>
                    <Button component={Link} href="/" variant="subtle" mt="md">
                        Go home
                    </Button>
                </Stack>
            </Container>
        </>
    );
}
