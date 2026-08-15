import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FeedCandidateSelector } from './FeedCandidateSelector';

describe('FeedCandidateSelector', () => {
    it('renders selectable feeds and flags matching recent content', () => {
        const markup = renderToStaticMarkup(
            <MantineProvider>
                <FeedCandidateSelector
                    candidates={[
                        {
                            title: 'Raspberry Pi',
                            feedUrl: 'https://www.raspberrypi.com/feed/',
                            siteUrl: 'https://www.raspberrypi.com/',
                            identicalTo: [
                                'https://www.raspberrypi.com/news/feed/',
                            ],
                        },
                        {
                            title: 'News - Raspberry Pi',
                            feedUrl: 'https://www.raspberrypi.com/news/feed/',
                            siteUrl: 'https://www.raspberrypi.com/news/',
                            identicalTo: ['https://www.raspberrypi.com/feed/'],
                        },
                    ]}
                    error={null}
                    isPending={false}
                    onBack={() => undefined}
                    onSubmit={() => undefined}
                />
            </MantineProvider>,
        );

        expect(markup).toContain('Select the feed you want to follow.');
        expect(markup).toContain('Available feeds');
        expect(markup).toContain('Raspberry Pi');
        expect(markup).toContain('News - Raspberry Pi');
        expect(markup).toContain('Both feeds have the same recent posts.');
        expect(markup).not.toContain('Some feeds currently match');
        expect(markup).not.toContain('Website:');
        expect(markup).toContain('Add feed');
        expect(markup).toContain('disabled=""');
    });
});
