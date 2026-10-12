/*
 * Turns a user's or a model's search text into a safe FTS5 query.
 *
 * FTS5 has its own syntax (quotes, column filters, NEAR, ^, parentheses), and
 * a malformed query is an SQL error. Rather than pass text through, this keeps
 * a small, predictable subset:
 *
 *   climate policy     both words, anywhere (AND)
 *   "climate policy"   the exact phrase
 *   climat*            words starting with "climat"
 *   rust OR go         either side
 *   -crypto            exclude entries containing the word
 *
 * Every word becomes a quoted FTS5 string, so punctuation inside words is
 * harmless. Matching ignores case and accents (the table's tokenizer).
 */

const MAX_TERMS = 32;

export class SearchQueryError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SearchQueryError';
    }
}

interface Term {
    readonly text: string;
    readonly phrase: boolean;
    readonly prefix: boolean;
    readonly negated: boolean;
}

const TOKEN = /(-?)"([^"]*)"|(\S+)/gu;

const quote = (text: string): string => `"${text.replaceAll('"', '""')}"`;

// Keep letters, digits, and joiners; FTS5's tokenizer would split on the rest
// anyway, and leaving them in quoted strings is harmless but noisy.
const hasSearchableText = (text: string): boolean => /[\p{L}\p{N}]/u.test(text);

export const toFtsQuery = (input: string): string => {
    const parts: string[] = [];
    let positive = 0;
    let pendingOr = false;
    let terms = 0;

    for (const match of input.matchAll(TOKEN)) {
        const [, phraseSign, phraseText, word] = match;
        if (word !== undefined && word === 'OR') {
            pendingOr = parts.length > 0;
            continue;
        }
        let term: Term;
        if (phraseText !== undefined) {
            term = {
                text: phraseText.trim(),
                phrase: true,
                prefix: false,
                negated: phraseSign === '-',
            };
        } else {
            const raw = word ?? '';
            const negated = raw.startsWith('-') && raw.length > 1;
            const body = negated ? raw.slice(1) : raw;
            const prefix = body.endsWith('*');
            term = {
                text: (prefix ? body.slice(0, -1) : body).replaceAll('"', ''),
                phrase: false,
                prefix,
                negated,
            };
        }
        if (!hasSearchableText(term.text)) continue;
        terms += 1;
        if (terms > MAX_TERMS) {
            throw new SearchQueryError(
                `Use at most ${MAX_TERMS} search terms.`,
            );
        }

        const expression = `${quote(term.text)}${term.prefix ? '*' : ''}`;
        if (term.negated) {
            // FTS5 NOT is binary; it is attached after the positive terms.
            parts.push(`NOT ${expression}`);
            pendingOr = false;
            continue;
        }
        positive += 1;
        if (pendingOr && parts.length > 0) {
            parts.push(`OR ${expression}`);
        } else {
            parts.push(expression);
        }
        pendingOr = false;
    }

    if (positive === 0) {
        throw new SearchQueryError(
            'Search for at least one word that is not excluded.',
        );
    }
    // Exclusions apply to the whole positive expression: `(a OR b) NOT c`.
    // FTS5's NOT binds tighter than AND and OR, hence the parentheses.
    const included = parts.filter((part) => !part.startsWith('NOT '));
    const excluded = parts.filter((part) => part.startsWith('NOT '));
    const positiveExpression =
        excluded.length > 0 && included.length > 1
            ? `(${included.join(' ')})`
            : included.join(' ');
    return [positiveExpression, ...excluded].join(' ');
};
