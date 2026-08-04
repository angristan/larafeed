import { Kbd, Modal } from '@mantine/core';

interface ReaderShortcutHelpProps {
    readonly opened: boolean;
    readonly onClose: () => void;
}

export function ReaderShortcutHelp({
    opened,
    onClose,
}: ReaderShortcutHelpProps) {
    return (
        <Modal
            opened={opened}
            onClose={onClose}
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
    );
}
