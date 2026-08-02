interface ShortcutHelpKey {
    readonly key: string;
    readonly shiftKey: boolean;
    readonly altKey: boolean;
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
}

export function isShortcutHelpKey(event: ShortcutHelpKey): boolean {
    return (
        event.key === '?' &&
        event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
    );
}
