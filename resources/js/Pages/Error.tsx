import { Head, Link } from '@inertiajs/react';
import { Button, Group, Stack, Text } from '@mantine/core';
import {
    IconAlertTriangle,
    IconArrowLeft,
    IconHome,
    IconRefresh,
} from '@tabler/icons-react';
import AuthLayout from '@/Layouts/AuthLayout/AuthLayout';

interface Props {
    status: number;
}

const titles: Record<number, string> = {
    400: 'Bad Request',
    401: 'Sign In Required',
    403: 'Forbidden',
    404: 'Page Not Found',
    409: 'Conflict',
    429: 'Too Many Requests',
    500: 'Server Error',
    503: 'Service Unavailable',
};

const descriptions: Record<number, string> = {
    400: 'The request could not be understood. Check the details and try again.',
    401: 'Please sign in before continuing to this page.',
    403: "You don't have permission to access this page.",
    404: "The page you're looking for doesn't exist or has been moved.",
    409: 'This action conflicts with the current state. Refresh and try again.',
    429: 'You have made too many requests. Wait a moment and try again.',
    500: 'Something went wrong on our end. Please try again later.',
    503: 'Larafeed is temporarily unavailable. Please try again shortly.',
};

export default function ErrorPage({ status }: Props) {
    const title = titles[status] ?? 'Error';
    const description = descriptions[status] ?? 'An unexpected error occurred.';
    const canRetry = status >= 500;

    return (
        <AuthLayout
            title={title}
            description={description}
            icon={<IconAlertTriangle size={22} stroke={1.7} />}
            footer={
                canRetry
                    ? 'If the problem keeps happening, check the server logs and try again in a moment.'
                    : undefined
            }
        >
            <Head title={title} />

            <Stack gap="xl" align="center">
                <Text
                    fz={{ base: 72, sm: 92 }}
                    fw={900}
                    lh={0.9}
                    c="blue"
                    aria-label={`Error ${status}`}
                >
                    {status}
                </Text>

                <Group grow w="100%" gap="sm">
                    <Button
                        variant="default"
                        leftSection={
                            canRetry ? (
                                <IconRefresh size={17} />
                            ) : (
                                <IconArrowLeft size={17} />
                            )
                        }
                        onClick={() => {
                            if (canRetry) {
                                window.location.reload();
                                return;
                            }

                            window.history.back();
                        }}
                    >
                        {canRetry ? 'Try again' : 'Go back'}
                    </Button>
                    <Button
                        component={Link}
                        href="/"
                        leftSection={<IconHome size={17} />}
                    >
                        Go home
                    </Button>
                </Group>
            </Stack>
        </AuthLayout>
    );
}
