import { PropsWithChildren, ReactNode } from 'react';

export default function Authenticated({
    children,
}: PropsWithChildren<{ header?: ReactNode }>) {
    return <div>{children}</div>;
}
