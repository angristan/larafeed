import { Kbd, Modal, Table, Text } from '@mantine/core';

interface ReaderShortcutHelpProps {
    readonly opened: boolean;
    readonly onClose: () => void;
}

const shortcuts = [
    { keys: ['J'], action: 'Open the next entry in the current list' },
    { keys: ['K'], action: 'Open the previous entry in the current list' },
    { keys: ['⌘/Ctrl', 'K'], action: 'Focus feed search' },
    { keys: ['Escape'], action: 'Clear and leave feed search' },
    { keys: ['Shift', '?'], action: 'Open this shortcut guide' },
] as const;

export function ReaderShortcutHelp({
    opened,
    onClose,
}: ReaderShortcutHelpProps) {
    return (
        <Modal
            centered
            onClose={onClose}
            opened={opened}
            title="Keyboard shortcuts"
        >
            <Text c="dimmed" mb="md" size="sm">
                Shortcuts are disabled while you type in a form field.
            </Text>
            <Table aria-label="Reader keyboard shortcuts" verticalSpacing="sm">
                <Table.Thead>
                    <Table.Tr>
                        <Table.Th>Keys</Table.Th>
                        <Table.Th>Action</Table.Th>
                    </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                    {shortcuts.map((shortcut) => (
                        <Table.Tr key={shortcut.action}>
                            <Table.Td>
                                {shortcut.keys.map((key, index) => (
                                    <span key={key}>
                                        {index > 0 && ' + '}
                                        <Kbd>{key}</Kbd>
                                    </span>
                                ))}
                            </Table.Td>
                            <Table.Td>{shortcut.action}</Table.Td>
                        </Table.Tr>
                    ))}
                </Table.Tbody>
            </Table>
        </Modal>
    );
}
