import { ActionIcon, Kbd, Modal } from '@mantine/core';
import { useDisclosure, useHotkeys } from '@mantine/hooks';
import { IconKeyboard } from '@tabler/icons-react';

export default function KeyboardShortcuts() {
    const [opened, { open, close }] = useDisclosure(false);

    useHotkeys([['shift+?', () => (opened ? close() : open())]]);

    return (
        <>
            <Modal
                opened={opened}
                onClose={close}
                title={<h2 style={{ marginBottom: 0 }}>Keyboard shortcuts</h2>}
            >
                <div
                    dir="ltr"
                    style={{ paddingRight: '1rem', paddingLeft: '1rem' }}
                >
                    <h3>Global:</h3>
                    <p>
                        <Kbd>⇧ Shift</Kbd>+<Kbd>?</Kbd> - Show this help
                    </p>
                    <p>
                        <Kbd>⌘ Cmd</Kbd>+<Kbd>k</Kbd> - Spotlight search
                    </p>
                    <p>
                        <Kbd>⌘ Cmd</Kbd>+<Kbd>j</Kbd> - Toggle dark/light theme
                    </p>
                    <h3>On the entry list:</h3>
                    <p>
                        <Kbd>j</Kbd> - Next entry
                    </p>
                    <p>
                        <Kbd>k</Kbd> - Previous entry
                    </p>
                </div>
            </Modal>
            <ActionIcon
                variant="default"
                size="lg"
                aria-label="Toggle color scheme"
                mt={1}
                onClick={open}
            >
                <IconKeyboard stroke={1.5} size={20} />
            </ActionIcon>
        </>
    );
}
