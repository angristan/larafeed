import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { D1, D1Statement } from '../infrastructure/d1';
import { makeCompatibilityRepository } from './repository';

const result = (results: readonly unknown[] = []): D1Result<unknown> =>
    ({ results, success: true, meta: { changes: 0 } }) as D1Result<unknown>;

describe('compatibility query bounds', () => {
    it('limits metadata and ID reads without joining article content', async () => {
        const statements: D1Statement[] = [];
        const d1 = {
            all: (statement: D1Statement) => {
                statements.push(statement);
                return Effect.succeed(result());
            },
        } as unknown as D1;
        const repository = makeCompatibilityRepository(d1);

        await Effect.runPromise(repository.listCategories(1));
        await Effect.runPromise(repository.listSubscriptions(1));
        await Effect.runPromise(repository.listItemIds(1, 'unread', 99_999));

        expect(statements).toHaveLength(3);
        for (const statement of statements) {
            expect(statement.sql).toContain('LIMIT ?');
        }
        const idStatement = statements[2];
        expect(idStatement?.bindings?.at(-1)).toBe(10_000);
        expect(idStatement?.sql).not.toContain('entry_contents');
        expect(idStatement?.sql).not.toContain('content_html');
        expect(idStatement?.sql).toMatch(/SELECT\s+e\.id/u);
    });
});
