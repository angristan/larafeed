import { Head } from '@inertiajs/react';
import { PropsWithChildren } from 'react';

export default function Authenticated({
    children,
    pageTitle,
}: PropsWithChildren<{ pageTitle?: string }>) {
    return (
        <div>
            <Head title={pageTitle}>
                {/* <script src="https://unpkg.com/react-scan/dist/auto.global.js"></script> */}
            </Head>
            {children}
        </div>
    );
}
