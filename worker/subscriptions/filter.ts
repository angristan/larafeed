import type { SubscriptionFilterRules } from '@shared/schemas/subscriptions';

export const MAX_FILTER_PATTERNS_PER_FIELD = 20;
export const MAX_FILTER_PATTERN_LENGTH = 200;

const nestedQuantifierPatterns = [
    /\([^)]*[+*][^)]*\)[+*{]/u,
    /\{\d+(?:,\d*)?\}\s*[+*{]/u,
    /(?:\.[+*]|\[[^\]]+\][+*])\s*[+*{]/u,
];
const backReference = /\\[1-9]/u;

export interface FilterCandidate {
    readonly title: string;
    readonly author: string | null;
    readonly contentHtml: string | null;
}

interface CompiledPattern {
    readonly regex: RegExp | null;
    readonly literal: string;
}

export interface CompiledSubscriptionFilterRules {
    readonly title: readonly CompiledPattern[];
    readonly content: readonly CompiledPattern[];
    readonly author: readonly CompiledPattern[];
}

const emptyRules = (): SubscriptionFilterRules => ({
    excludeTitle: [],
    excludeContent: [],
    excludeAuthor: [],
});

const stringArray = (value: unknown): readonly string[] | null => {
    if (!Array.isArray(value) || value.length > MAX_FILTER_PATTERNS_PER_FIELD) {
        return null;
    }
    const result: string[] = [];
    for (const item of value) {
        if (
            typeof item !== 'string' ||
            item.length === 0 ||
            item.length > MAX_FILTER_PATTERN_LENGTH ||
            item.trim() !== item
        ) {
            return null;
        }
        result.push(item);
    }
    return result;
};

export const parseStoredFilterRules = (
    value: string | null,
): SubscriptionFilterRules => {
    if (value === null) return emptyRules();
    try {
        const parsed: unknown = JSON.parse(value);
        if (typeof parsed !== 'object' || parsed === null) return emptyRules();
        const record = parsed as Record<string, unknown>;
        const excludeTitle = stringArray(
            record.excludeTitle ?? record.exclude_title ?? [],
        );
        const excludeContent = stringArray(
            record.excludeContent ?? record.exclude_content ?? [],
        );
        const excludeAuthor = stringArray(
            record.excludeAuthor ?? record.exclude_author ?? [],
        );
        if (
            excludeTitle === null ||
            excludeContent === null ||
            excludeAuthor === null
        ) {
            return emptyRules();
        }
        return { excludeTitle, excludeContent, excludeAuthor };
    } catch {
        return emptyRules();
    }
};

export const serializeFilterRules = (
    rules: SubscriptionFilterRules,
): string | null => {
    if (
        rules.excludeTitle.length === 0 &&
        rules.excludeContent.length === 0 &&
        rules.excludeAuthor.length === 0
    ) {
        return null;
    }
    return JSON.stringify({
        exclude_title: rules.excludeTitle,
        exclude_content: rules.excludeContent,
        exclude_author: rules.excludeAuthor,
    });
};

export const isSafeFilterPattern = (pattern: string): boolean =>
    pattern.length > 0 &&
    pattern.length <= MAX_FILTER_PATTERN_LENGTH &&
    !backReference.test(pattern) &&
    nestedQuantifierPatterns.every((unsafe) => !unsafe.test(pattern));

export const validateFilterRules = (rules: SubscriptionFilterRules): boolean =>
    rules.excludeTitle.length <= MAX_FILTER_PATTERNS_PER_FIELD &&
    rules.excludeContent.length <= MAX_FILTER_PATTERNS_PER_FIELD &&
    rules.excludeAuthor.length <= MAX_FILTER_PATTERNS_PER_FIELD &&
    [
        ...rules.excludeTitle,
        ...rules.excludeContent,
        ...rules.excludeAuthor,
    ].every(isSafeFilterPattern);

const compilePattern = (pattern: string): CompiledPattern => {
    try {
        return { regex: new RegExp(pattern, 'iu'), literal: '' };
    } catch {
        return { regex: null, literal: pattern.toLocaleLowerCase() };
    }
};

export const compileFilterRules = (
    rules: SubscriptionFilterRules,
): CompiledSubscriptionFilterRules => ({
    title: rules.excludeTitle.map(compilePattern),
    content: rules.excludeContent.map(compilePattern),
    author: rules.excludeAuthor.map(compilePattern),
});

const matches = (patterns: readonly CompiledPattern[], value: string) =>
    patterns.some((pattern) =>
        pattern.regex === null
            ? value.toLocaleLowerCase().includes(pattern.literal)
            : pattern.regex.test(value),
    );

export const matchesSubscriptionFilter = (
    candidate: FilterCandidate,
    rules: CompiledSubscriptionFilterRules,
): boolean =>
    matches(rules.title, candidate.title) ||
    matches(rules.content, candidate.contentHtml ?? '') ||
    matches(rules.author, candidate.author ?? '');
