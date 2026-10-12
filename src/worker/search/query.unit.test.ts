import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { SearchQueryError, toFtsQuery } from './query';

// Runs the generated queries against a real FTS5 table with the same
// tokenizer as migration 0023, so the tests check what matches, not strings.
const database = new DatabaseSync(':memory:');
database.exec(`
    CREATE VIRTUAL TABLE entry_search USING fts5(
        title, author, body,
        tokenize = 'unicode61 remove_diacritics 2'
    );
    INSERT INTO entry_search (rowid, title, author, body) VALUES
        (1, 'Climate policy in Europe', 'Ana', 'Carbon taxes and the café economy'),
        (2, 'Rust 2.0 released', 'Bo', 'Memory safety without crypto hype'),
        (3, 'Go generics', 'Cy', 'A crypto exchange rewrote its backend in Go'),
        (4, 'Policy notes', 'Di', 'Climate is mentioned, policy too, far apart');
`);
const search = (input: string): number[] =>
    database
        .prepare(
            'SELECT rowid FROM entry_search WHERE entry_search MATCH ? ORDER BY rowid',
        )
        .all(toFtsQuery(input))
        .map((row) => Number(row.rowid));

describe('toFtsQuery', () => {
    it('matches all words, phrases, prefixes, OR, and exclusions', () => {
        expect(search('climate policy')).toEqual([1, 4]);
        expect(search('"climate policy"')).toEqual([1]);
        expect(search('climat*')).toEqual([1, 4]);
        expect(search('rust OR go')).toEqual([2, 3]);
        expect(search('rust OR go -crypto')).toEqual([]);
        expect(search('policy -europe')).toEqual([4]);
    });

    it('ignores case and accents', () => {
        expect(search('CAFE')).toEqual([1]);
    });

    it('treats FTS5 syntax in user text as plain words', () => {
        expect(search('title:rust')).toEqual([]);
        expect(search('rust" OR "x')).toEqual([2]);
        expect(search('(go) AND NEAR')).toEqual([]);
        expect(() => search('2.0 ^released')).not.toThrow();
    });

    it('rejects text with nothing to search for', () => {
        expect(() => toFtsQuery('  -- ** ')).toThrow(SearchQueryError);
        expect(() => toFtsQuery('-rust')).toThrow(SearchQueryError);
    });
});
