import { Link } from '@inertiajs/react';
import {
    Badge,
    Box,
    Container,
    Group,
    Paper,
    Stack,
    Text,
    ThemeIcon,
    Title,
} from '@mantine/core';
import { IconBolt, IconListCheck, IconRss } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import ApplicationLogo from '@/Components/ApplicationLogo/ApplicationLogo';
import ColorSchemeSwitcher from '@/Components/ColorSchemeSwitcher/ColorSchemeSwitcher';
import classes from './AuthLayout.module.css';

interface AuthLayoutProps {
    title: string;
    description: ReactNode;
    icon: ReactNode;
    children: ReactNode;
    footer?: ReactNode;
}

const highlights = [
    {
        icon: IconRss,
        title: 'Your subscriptions, your order',
        description: 'Follow the sources you choose without an algorithm.',
    },
    {
        icon: IconBolt,
        title: 'Built to move quickly',
        description: 'Scan, star, and read with a keyboard-friendly workflow.',
    },
    {
        icon: IconListCheck,
        title: 'A queue you can actually finish',
        description: 'Filter the noise and keep your reading list intentional.',
    },
];

export default function AuthLayout({
    title,
    description,
    icon,
    children,
    footer,
}: AuthLayoutProps) {
    return (
        <Box className={classes.page}>
            <header className={classes.header}>
                <Container size="lg">
                    <Group justify="space-between" wrap="nowrap">
                        <Link
                            href="/"
                            className={classes.brand}
                            aria-label="Larafeed home"
                        >
                            <span className={classes.brandMark}>
                                <ApplicationLogo
                                    width={25}
                                    aria-hidden="true"
                                />
                            </span>
                            <Text fw={800} size="lg">
                                Larafeed
                            </Text>
                        </Link>
                        <ColorSchemeSwitcher />
                    </Group>
                </Container>
            </header>

            <Container size="lg" className={classes.main}>
                <div className={classes.grid}>
                    <Stack className={classes.intro} gap="xl">
                        <Stack gap="md">
                            <Badge
                                variant="light"
                                radius="xl"
                                size="lg"
                                className={classes.badge}
                            >
                                Built for focus
                            </Badge>
                            <Title
                                order={1}
                                component="p"
                                className={classes.heroTitle}
                            >
                                The web you chose, without the noise.
                            </Title>
                            <Text
                                size="lg"
                                c="dimmed"
                                className={classes.heroDescription}
                            >
                                Bring every feed into one calm reading flow,
                                then spend your attention where it matters.
                            </Text>
                        </Stack>

                        <Stack gap="lg" className={classes.highlights}>
                            {highlights.map((highlight) => {
                                const HighlightIcon = highlight.icon;

                                return (
                                    <Group
                                        key={highlight.title}
                                        align="flex-start"
                                        wrap="nowrap"
                                        gap="md"
                                    >
                                        <ThemeIcon
                                            variant="light"
                                            radius="md"
                                            size={38}
                                            className={classes.highlightIcon}
                                        >
                                            <HighlightIcon
                                                size={19}
                                                stroke={1.7}
                                            />
                                        </ThemeIcon>
                                        <div>
                                            <Text fw={700} size="sm">
                                                {highlight.title}
                                            </Text>
                                            <Text size="sm" c="dimmed" mt={2}>
                                                {highlight.description}
                                            </Text>
                                        </div>
                                    </Group>
                                );
                            })}
                        </Stack>
                    </Stack>

                    <main className={classes.formColumn}>
                        <Stack gap="lg">
                            <Stack gap="sm" align="flex-start">
                                <ThemeIcon
                                    size={44}
                                    radius="md"
                                    variant="light"
                                    aria-hidden="true"
                                >
                                    {icon}
                                </ThemeIcon>
                                <div>
                                    <Title
                                        order={1}
                                        id="auth-page-title"
                                        className={classes.formTitle}
                                    >
                                        {title}
                                    </Title>
                                    <Text c="dimmed" size="sm" mt={6}>
                                        {description}
                                    </Text>
                                </div>
                            </Stack>

                            <Paper
                                withBorder
                                radius="xl"
                                p={{ base: 'lg', sm: 30 }}
                                className={classes.card}
                            >
                                {children}
                            </Paper>

                            {footer && (
                                <Text size="sm" c="dimmed" ta="center">
                                    {footer}
                                </Text>
                            )}
                        </Stack>
                    </main>
                </div>
            </Container>
        </Box>
    );
}
