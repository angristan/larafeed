import { Group, Kbd, Modal, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';

interface ReaderShortcutHelpProps {
    readonly opened: boolean;
    readonly onClose: () => void;
}

/**
 * Mantine's `mod` hotkeys map to Command on Apple platforms and to Ctrl
 * everywhere else, so the help shows the key the user actually presses.
 */
export function modifierKeyLabel(platform: string): string {
    return /Mac|iPhone|iPad|iPod/u.test(platform) ? '⌘' : 'Ctrl';
}

function currentPlatform(): string {
    if (typeof navigator === 'undefined') return '';
    return navigator.platform || navigator.userAgent;
}

function Shortcut({
    keys,
    children,
}: {
    readonly keys: readonly string[];
    readonly children: ReactNode;
}) {
    return (
        <Group gap="sm" justify="space-between" wrap="nowrap">
            <Text size="sm">{children}</Text>
            <Group gap={4} wrap="nowrap">
                {keys.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                ))}
            </Group>
        </Group>
    );
}

export function ReaderShortcutHelp({
    opened,
    onClose,
}: ReaderShortcutHelpProps) {
    const mod = modifierKeyLabel(currentPlatform());

    return (
        <Modal onClose={onClose} opened={opened} title="Keyboard shortcuts">
            <Stack dir="ltr" gap="lg">
                <Stack gap="xs">
                    <Title order={3}>Everywhere</Title>
                    <Shortcut keys={['Shift', '?']}>Show this help</Shortcut>
                    <Shortcut keys={[mod, 'k']}>Search</Shortcut>
                    <Shortcut keys={[mod, 'j']}>
                        Switch light and dark mode
                    </Shortcut>
                </Stack>
                <Stack gap="xs">
                    <Title order={3}>Entry list</Title>
                    <Shortcut keys={['j']}>Next entry</Shortcut>
                    <Shortcut keys={['k']}>Previous entry</Shortcut>
                </Stack>
            </Stack>
        </Modal>
    );
}
