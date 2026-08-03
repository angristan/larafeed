import { useEffect } from 'react';

const APP_TITLE = 'Larafeed';
let titleOwner: symbol | null = null;

export function formatDocumentTitle(pageTitle: string): string {
    return `${pageTitle} - ${APP_TITLE}`;
}

export function setDocumentTitle(pageTitle: string): () => void {
    const owner = Symbol(pageTitle);
    const title = formatDocumentTitle(pageTitle);
    titleOwner = owner;
    document.title = title;

    return () => {
        if (titleOwner !== owner) return;
        titleOwner = null;
        if (document.title === title) document.title = APP_TITLE;
    };
}

export function useDocumentTitle(pageTitle: string): void {
    useEffect(() => setDocumentTitle(pageTitle), [pageTitle]);
}
