import { describe, expect, it } from 'vitest';

import { htmlToText } from './content';

describe('htmlToText', () => {
    it('keeps article structure, link targets, and image descriptions', async () => {
        const text = await htmlToText(
            [
                '<h2>Release &amp; notes</h2>',
                '<p>Read   the\n<a href="https://example.test/post">full post</a>',
                ' or <a href="/relative">this</a>.</p>',
                '<ul><li>First</li><li><strong>Second</strong> item</li></ul>',
                '<p><img src="x.png" alt="A &quot;chart&quot;"></p>',
                '<p>Caf&#233; &#x2014; done</p>',
            ].join(''),
        );

        expect(text).toBe(
            [
                '## Release & notes',
                '',
                'Read the full post (https://example.test/post) or this.',
                '',
                '- First',
                '- Second item',
                '',
                '[image: A "chart"]',
                '',
                'Café — done',
            ].join('\n'),
        );
    });

    it('preserves whitespace inside preformatted blocks', async () => {
        const text = await htmlToText(
            '<p>Code:</p><pre>if (a) {\n    b();\n}</pre>',
        );

        expect(text).toBe('Code:\n\n```\nif (a) {\n    b();\n}\n```');
    });
});
