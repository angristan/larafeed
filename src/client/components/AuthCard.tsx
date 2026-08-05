import {
    Center,
    Container,
    Paper,
    Stack,
    type StackProps,
    Text,
    Title,
} from '@mantine/core';
import type { PropsWithChildren, ReactElement } from 'react';
import ApplicationLogo from './ApplicationLogo';
import classes from './AuthCard.module.css';

interface AuthCardProps extends PropsWithChildren {
    readonly title: string;
    readonly description: string;
    readonly gap?: StackProps['gap'];
}

export function AuthCard({
    title,
    description,
    children,
    gap = 'lg',
}: AuthCardProps): ReactElement {
    return (
        <main className={classes.canvas}>
            <Container component="div" size={460} px="md">
                <Center mih="100dvh" py="xl">
                    <Stack gap="xl" w="100%">
                        <Stack align="center" gap="md" ta="center">
                            <div className={classes.brand}>
                                <ApplicationLogo width={42} />
                                <Text fw={750} fz="lg">
                                    Larafeed
                                </Text>
                            </div>
                            <Stack gap={6}>
                                <Title order={1}>{title}</Title>
                                <Text c="dimmed" size="sm">
                                    {description}
                                </Text>
                            </Stack>
                        </Stack>

                        <Paper
                            className={classes.panel}
                            p={{ base: 'lg', sm: 'xl' }}
                            withBorder
                        >
                            <Stack gap={gap}>{children}</Stack>
                        </Paper>

                        <Text
                            className={classes.privateNote}
                            c="dimmed"
                            size="xs"
                            ta="center"
                        >
                            Private reader · Passkey access only
                        </Text>
                    </Stack>
                </Center>
            </Container>
        </main>
    );
}
