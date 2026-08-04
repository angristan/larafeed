import type { SubscriptionFilterRules } from '@shared/schemas/subscriptions';

export const MAX_FILTER_PATTERNS_PER_FIELD = 20;
export const MAX_FILTER_PATTERN_LENGTH = 200;

const MAX_REPEAT_COUNT = 256;
const MAX_NFA_STATES = 1024;

export interface FilterCandidate {
    readonly title: string;
    readonly author: string | null;
    readonly contentHtml: string | null;
}

type AssertionKind = 'start' | 'end' | 'word-boundary' | 'not-word-boundary';

type SimpleMatcher =
    | { readonly kind: 'literal'; readonly value: string }
    | {
          readonly kind: 'range';
          readonly minimum: number;
          readonly maximum: number;
      }
    | {
          readonly kind: 'digit' | 'word' | 'space';
          readonly negated: boolean;
      };

type CharacterMatcher =
    | SimpleMatcher
    | { readonly kind: 'any' }
    | {
          readonly kind: 'class';
          readonly negated: boolean;
          readonly terms: readonly SimpleMatcher[];
      };

type AstNode =
    | { readonly kind: 'empty' }
    | { readonly kind: 'character'; readonly matcher: CharacterMatcher }
    | { readonly kind: 'assertion'; readonly assertion: AssertionKind }
    | { readonly kind: 'sequence'; readonly nodes: readonly AstNode[] }
    | { readonly kind: 'alternation'; readonly nodes: readonly AstNode[] }
    | {
          readonly kind: 'repeat';
          readonly node: AstNode;
          readonly minimum: number;
          readonly maximum: number | null;
      };

type NfaState =
    | {
          readonly kind: 'character';
          readonly matcher: CharacterMatcher;
          out: number | null;
      }
    | {
          readonly kind: 'assertion';
          readonly assertion: AssertionKind;
          out: number | null;
      }
    | { readonly kind: 'epsilon'; out: number | null }
    | { readonly kind: 'split'; out: number | null; out1: number | null }
    | { readonly kind: 'match' };

interface SafePattern {
    readonly states: readonly NfaState[];
    readonly start: number;
}

interface CompiledPattern {
    readonly safePattern: SafePattern | null;
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
    if (!Array.isArray(value)) return null;
    const result: string[] = [];
    for (const item of value) {
        if (typeof item !== 'string') return null;
        // Legacy filter compilation ignored empty rows left by the editor.
        if (item.length === 0) continue;
        if (item.length > MAX_FILTER_PATTERN_LENGTH) return null;
        result.push(item);
        if (result.length > MAX_FILTER_PATTERNS_PER_FIELD) return null;
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

// Every accepted pattern is safe because unsupported regex syntax is matched as
// literal text. Length limits still bound parser and matcher construction work.
export const isSafeFilterPattern = (pattern: string): boolean =>
    pattern.length > 0 && pattern.length <= MAX_FILTER_PATTERN_LENGTH;

export const validateFilterRules = (rules: SubscriptionFilterRules): boolean =>
    rules.excludeTitle.length <= MAX_FILTER_PATTERNS_PER_FIELD &&
    rules.excludeContent.length <= MAX_FILTER_PATTERNS_PER_FIELD &&
    rules.excludeAuthor.length <= MAX_FILTER_PATTERNS_PER_FIELD &&
    [
        ...rules.excludeTitle,
        ...rules.excludeContent,
        ...rules.excludeAuthor,
    ].every(isSafeFilterPattern);

const foldCase = (value: string): string => value.toLowerCase();

class PatternSyntaxError extends Error {}

class PatternParser {
    private readonly characters: readonly string[];
    private index = 0;

    constructor(pattern: string) {
        this.characters = Array.from(pattern);
    }

    parse(): AstNode {
        const result = this.parseAlternation();
        if (!this.atEnd()) throw new PatternSyntaxError();
        return result;
    }

    private parseAlternation(): AstNode {
        const alternatives = [this.parseSequence()];
        while (this.current() === '|') {
            this.index += 1;
            alternatives.push(this.parseSequence());
        }
        return alternatives.length === 1
            ? alternatives[0]
            : { kind: 'alternation', nodes: alternatives };
    }

    private parseSequence(): AstNode {
        const nodes: AstNode[] = [];
        while (
            !this.atEnd() &&
            this.current() !== ')' &&
            this.current() !== '|'
        ) {
            nodes.push(this.parseRepeatedAtom());
        }
        if (nodes.length === 0) return { kind: 'empty' };
        return nodes.length === 1 ? nodes[0] : { kind: 'sequence', nodes };
    }

    private parseRepeatedAtom(): AstNode {
        const { node, quantifiable } = this.parseAtom();
        const character = this.current();
        let minimum: number | null = null;
        let maximum: number | null = null;

        if (character === '?') {
            minimum = 0;
            maximum = 1;
            this.index += 1;
        } else if (character === '*') {
            minimum = 0;
            maximum = null;
            this.index += 1;
        } else if (character === '+') {
            minimum = 1;
            maximum = null;
            this.index += 1;
        } else if (character === '{') {
            ({ minimum, maximum } = this.parseBoundedQuantifier());
        }

        if (minimum === null) return node;
        if (!quantifiable) throw new PatternSyntaxError();
        if (this.current() === '?') this.index += 1; // Greediness does not affect existence.
        if (
            minimum > MAX_REPEAT_COUNT ||
            (maximum !== null && maximum > MAX_REPEAT_COUNT)
        ) {
            throw new PatternSyntaxError();
        }
        return { kind: 'repeat', node, minimum, maximum };
    }

    private parseAtom(): {
        readonly node: AstNode;
        readonly quantifiable: boolean;
    } {
        const character = this.current();
        if (character === undefined) throw new PatternSyntaxError();
        this.index += 1;

        if (character === '^') {
            return {
                node: { kind: 'assertion', assertion: 'start' },
                quantifiable: false,
            };
        }
        if (character === '$') {
            return {
                node: { kind: 'assertion', assertion: 'end' },
                quantifiable: false,
            };
        }
        if (character === '.') {
            return {
                node: { kind: 'character', matcher: { kind: 'any' } },
                quantifiable: true,
            };
        }
        if (character === '[') {
            return {
                node: {
                    kind: 'character',
                    matcher: this.parseCharacterClass(),
                },
                quantifiable: true,
            };
        }
        if (character === '(') {
            if (this.current() === '?') {
                this.index += 1;
                if (this.current() !== ':') throw new PatternSyntaxError();
                this.index += 1;
            }
            const node = this.parseAlternation();
            if (this.current() !== ')') throw new PatternSyntaxError();
            this.index += 1;
            return { node, quantifiable: true };
        }
        if (character === '\\') {
            const escaped = this.parseEscape(false);
            if ('assertion' in escaped) {
                return {
                    node: { kind: 'assertion', assertion: escaped.assertion },
                    quantifiable: false,
                };
            }
            return {
                node: { kind: 'character', matcher: escaped },
                quantifiable: true,
            };
        }
        if ('?*+{})]'.includes(character)) throw new PatternSyntaxError();
        return {
            node: {
                kind: 'character',
                matcher: { kind: 'literal', value: foldCase(character) },
            },
            quantifiable: true,
        };
    }

    private parseBoundedQuantifier(): {
        readonly minimum: number;
        readonly maximum: number | null;
    } {
        this.index += 1;
        const minimum = this.parseDecimal();
        if (minimum === null) throw new PatternSyntaxError();
        if (this.current() === '}') {
            this.index += 1;
            return { minimum, maximum: minimum };
        }
        if (this.current() !== ',') throw new PatternSyntaxError();
        this.index += 1;
        const maximum = this.parseDecimal();
        if (this.current() !== '}') throw new PatternSyntaxError();
        this.index += 1;
        if (maximum !== null && maximum < minimum)
            throw new PatternSyntaxError();
        return { minimum, maximum };
    }

    private parseDecimal(): number | null {
        const start = this.index;
        let result = 0;
        while (this.isAsciiDigit(this.current())) {
            result = result * 10 + Number(this.current());
            if (!Number.isSafeInteger(result)) throw new PatternSyntaxError();
            this.index += 1;
        }
        return this.index === start ? null : result;
    }

    private parseCharacterClass(): CharacterMatcher {
        let negated = false;
        if (this.current() === '^') {
            negated = true;
            this.index += 1;
        }

        const terms: SimpleMatcher[] = [];
        while (this.current() !== ']') {
            if (this.atEnd()) throw new PatternSyntaxError();
            const left = this.parseClassTerm();
            if (this.current() === '-' && this.peek() !== ']') {
                this.index += 1;
                const right = this.parseClassTerm();
                if (left.kind !== 'literal' || right.kind !== 'literal') {
                    throw new PatternSyntaxError();
                }
                const minimum = this.singleCodePoint(left.value);
                const maximum = this.singleCodePoint(right.value);
                if (minimum > maximum) throw new PatternSyntaxError();
                terms.push({ kind: 'range', minimum, maximum });
            } else {
                terms.push(left);
            }
        }
        this.index += 1;
        return { kind: 'class', negated, terms };
    }

    private parseClassTerm(): SimpleMatcher {
        const character = this.current();
        if (character === undefined || character === ']') {
            throw new PatternSyntaxError();
        }
        this.index += 1;
        if (character === '\\') {
            const escaped = this.parseEscape(true);
            if (
                'assertion' in escaped ||
                escaped.kind === 'any' ||
                escaped.kind === 'class'
            ) {
                throw new PatternSyntaxError();
            }
            return escaped;
        }
        return { kind: 'literal', value: foldCase(character) };
    }

    private parseEscape(
        inCharacterClass: boolean,
    ): CharacterMatcher | { readonly assertion: AssertionKind } {
        const character = this.current();
        if (character === undefined) throw new PatternSyntaxError();
        this.index += 1;

        if (!inCharacterClass && (character === 'b' || character === 'B')) {
            return {
                assertion:
                    character === 'b' ? 'word-boundary' : 'not-word-boundary',
            };
        }
        if (inCharacterClass && character === 'b') {
            return { kind: 'literal', value: '\b' };
        }
        if (character === 'd' || character === 'D') {
            return { kind: 'digit', negated: character === 'D' };
        }
        if (character === 'w' || character === 'W') {
            return { kind: 'word', negated: character === 'W' };
        }
        if (character === 's' || character === 'S') {
            return { kind: 'space', negated: character === 'S' };
        }

        const escapedCharacters: Readonly<Record<string, string>> = {
            n: '\n',
            r: '\r',
            t: '\t',
            f: '\f',
            v: '\v',
        };
        const escapedCharacter = escapedCharacters[character];
        if (escapedCharacter !== undefined) {
            return { kind: 'literal', value: escapedCharacter };
        }
        if (character === '0') {
            if (this.isAsciiDigit(this.current()))
                throw new PatternSyntaxError();
            return { kind: 'literal', value: '\0' };
        }
        if (character === 'x') {
            return {
                kind: 'literal',
                value: foldCase(this.parseHexCharacter(2)),
            };
        }
        if (character === 'u') {
            return {
                kind: 'literal',
                value: foldCase(this.parseUnicodeEscape()),
            };
        }

        const escapable = inCharacterClass
            ? '^$\\.*+?()[]{}|/-'
            : '^$\\.*+?()[]{}|/';
        if (escapable.includes(character)) {
            return { kind: 'literal', value: foldCase(character) };
        }
        throw new PatternSyntaxError();
    }

    private parseHexCharacter(length: number): string {
        let hexadecimal = '';
        for (let index = 0; index < length; index += 1) {
            const character = this.current();
            if (character === undefined || !this.isHexDigit(character)) {
                throw new PatternSyntaxError();
            }
            hexadecimal += character;
            this.index += 1;
        }
        return String.fromCodePoint(Number.parseInt(hexadecimal, 16));
    }

    private parseUnicodeEscape(): string {
        if (this.current() !== '{') return this.parseHexCharacter(4);
        this.index += 1;
        let hexadecimal = '';
        while (this.current() !== '}') {
            const character = this.current();
            if (
                character === undefined ||
                hexadecimal.length >= 6 ||
                !this.isHexDigit(character)
            ) {
                throw new PatternSyntaxError();
            }
            hexadecimal += character;
            this.index += 1;
        }
        if (hexadecimal.length === 0) throw new PatternSyntaxError();
        this.index += 1;
        const codePoint = Number.parseInt(hexadecimal, 16);
        if (codePoint > 0x10ffff) throw new PatternSyntaxError();
        return String.fromCodePoint(codePoint);
    }

    private singleCodePoint(value: string): number {
        const characters = Array.from(value);
        if (characters.length !== 1) throw new PatternSyntaxError();
        const codePoint = characters[0].codePointAt(0);
        if (codePoint === undefined) throw new PatternSyntaxError();
        return codePoint;
    }

    private isAsciiDigit(character: string | undefined): character is string {
        return character !== undefined && character >= '0' && character <= '9';
    }

    private isHexDigit(character: string): boolean {
        const folded = foldCase(character);
        return this.isAsciiDigit(character) || (folded >= 'a' && folded <= 'f');
    }

    private current(): string | undefined {
        return this.characters[this.index];
    }

    private peek(): string | undefined {
        return this.characters[this.index + 1];
    }

    private atEnd(): boolean {
        return this.index >= this.characters.length;
    }
}

type Patch = readonly [state: number, field: 'out' | 'out1'];

interface Fragment {
    readonly start: number;
    readonly outs: readonly Patch[];
}

class NfaBuilder {
    readonly states: NfaState[] = [];

    compile(node: AstNode): SafePattern {
        const fragment = this.compileNode(node);
        const match = this.add({ kind: 'match' });
        this.patch(fragment.outs, match);
        return { states: this.states, start: fragment.start };
    }

    private compileNode(node: AstNode): Fragment {
        switch (node.kind) {
            case 'empty': {
                const state = this.add({ kind: 'epsilon', out: null });
                return { start: state, outs: [[state, 'out']] };
            }
            case 'character': {
                const state = this.add({
                    kind: 'character',
                    matcher: node.matcher,
                    out: null,
                });
                return { start: state, outs: [[state, 'out']] };
            }
            case 'assertion': {
                const state = this.add({
                    kind: 'assertion',
                    assertion: node.assertion,
                    out: null,
                });
                return { start: state, outs: [[state, 'out']] };
            }
            case 'sequence': {
                let result = this.compileNode({ kind: 'empty' });
                for (const child of node.nodes) {
                    result = this.concatenate(result, this.compileNode(child));
                }
                return result;
            }
            case 'alternation': {
                let result = this.compileNode(node.nodes[0]);
                for (const child of node.nodes.slice(1)) {
                    const right = this.compileNode(child);
                    const split = this.add({
                        kind: 'split',
                        out: result.start,
                        out1: right.start,
                    });
                    result = {
                        start: split,
                        outs: [...result.outs, ...right.outs],
                    };
                }
                return result;
            }
            case 'repeat':
                return this.compileRepeat(node);
        }
    }

    private compileRepeat(
        node: Extract<AstNode, { kind: 'repeat' }>,
    ): Fragment {
        let result = this.compileNode({ kind: 'empty' });
        for (let count = 0; count < node.minimum; count += 1) {
            result = this.concatenate(result, this.compileNode(node.node));
        }

        if (node.maximum === null) {
            const repeated = this.compileNode(node.node);
            const split = this.add({
                kind: 'split',
                out: repeated.start,
                out1: null,
            });
            this.patch(repeated.outs, split);
            return this.concatenate(result, {
                start: split,
                outs: [[split, 'out1']],
            });
        }

        for (let count = node.minimum; count < node.maximum; count += 1) {
            const optional = this.compileNode(node.node);
            const split = this.add({
                kind: 'split',
                out: optional.start,
                out1: null,
            });
            result = this.concatenate(result, {
                start: split,
                outs: [...optional.outs, [split, 'out1']],
            });
        }
        return result;
    }

    private concatenate(left: Fragment, right: Fragment): Fragment {
        this.patch(left.outs, right.start);
        return { start: left.start, outs: right.outs };
    }

    private add(state: NfaState): number {
        if (this.states.length >= MAX_NFA_STATES)
            throw new PatternSyntaxError();
        this.states.push(state);
        return this.states.length - 1;
    }

    private patch(patches: readonly Patch[], target: number): void {
        for (const [index, field] of patches) {
            const state = this.states[index];
            if (field === 'out1') {
                if (state.kind !== 'split') throw new PatternSyntaxError();
                state.out1 = target;
            } else {
                if (state.kind === 'match') throw new PatternSyntaxError();
                state.out = target;
            }
        }
    }
}

const compileSafePattern = (pattern: string): SafePattern | null => {
    try {
        return new NfaBuilder().compile(new PatternParser(pattern).parse());
    } catch {
        return null;
    }
};

const isAsciiWordCharacter = (character: string | undefined): boolean =>
    character !== undefined &&
    ((character >= 'a' && character <= 'z') ||
        (character >= 'A' && character <= 'Z') ||
        (character >= '0' && character <= '9') ||
        character === '_');

const isWhitespaceCharacter = (character: string): boolean => {
    const codePoint = character.codePointAt(0);
    return (
        codePoint !== undefined &&
        ((codePoint >= 0x0009 && codePoint <= 0x000d) ||
            codePoint === 0x0020 ||
            codePoint === 0x00a0 ||
            codePoint === 0x1680 ||
            (codePoint >= 0x2000 && codePoint <= 0x200a) ||
            codePoint === 0x2028 ||
            codePoint === 0x2029 ||
            codePoint === 0x202f ||
            codePoint === 0x205f ||
            codePoint === 0x3000 ||
            codePoint === 0xfeff)
    );
};

const matchesSimpleMatcher = (
    matcher: SimpleMatcher,
    character: string,
    foldedCharacter: string,
): boolean => {
    if (matcher.kind === 'literal') return foldedCharacter === matcher.value;
    if (matcher.kind === 'range') {
        const foldedCharacters = Array.from(foldedCharacter);
        const codePoint = foldedCharacters[0]?.codePointAt(0);
        return (
            foldedCharacters.length === 1 &&
            codePoint !== undefined &&
            codePoint >= matcher.minimum &&
            codePoint <= matcher.maximum
        );
    }

    let matched: boolean;
    if (matcher.kind === 'digit') {
        matched = character >= '0' && character <= '9';
    } else if (matcher.kind === 'word') {
        matched = isAsciiWordCharacter(character);
    } else {
        matched = isWhitespaceCharacter(character);
    }
    return matcher.negated ? !matched : matched;
};

const isLineTerminator = (character: string): boolean =>
    character === '\n' ||
    character === '\r' ||
    character === '\u2028' ||
    character === '\u2029';

const matchesCharacter = (
    matcher: CharacterMatcher,
    character: string,
    foldedCharacter: string,
): boolean => {
    if (matcher.kind === 'any') return !isLineTerminator(character);
    if (matcher.kind === 'class') {
        const matched = matcher.terms.some((term) =>
            matchesSimpleMatcher(term, character, foldedCharacter),
        );
        return matcher.negated ? !matched : matched;
    }
    return matchesSimpleMatcher(matcher, character, foldedCharacter);
};

const assertionMatches = (
    assertion: AssertionKind,
    position: number,
    characters: readonly string[],
): boolean => {
    if (assertion === 'start') return position === 0;
    if (assertion === 'end') return position === characters.length;
    const boundary =
        isAsciiWordCharacter(characters[position - 1]) !==
        isAsciiWordCharacter(characters[position]);
    return assertion === 'word-boundary' ? boundary : !boundary;
};

// Thompson-NFA simulation visits each compiled state at most once per input
// position. Ambiguous alternatives never cause recursive backtracking.
const matchesSafePattern = (pattern: SafePattern, value: string): boolean => {
    const characters = Array.from(value);
    const foldedCharacters = characters.map(foldCase);
    const marks = new Uint32Array(pattern.states.length);
    let generation = 0;
    let carry: number[] = [];

    for (let position = 0; position <= characters.length; position += 1) {
        generation += 1;
        const stack = [pattern.start, ...carry];
        const consuming: number[] = [];
        let accepted = false;

        while (stack.length > 0) {
            const stateIndex = stack.pop();
            if (stateIndex === undefined || marks[stateIndex] === generation) {
                continue;
            }
            marks[stateIndex] = generation;
            const state = pattern.states[stateIndex];
            if (state.kind === 'match') {
                accepted = true;
            } else if (state.kind === 'character') {
                consuming.push(stateIndex);
            } else if (state.kind === 'split') {
                if (state.out !== null) stack.push(state.out);
                if (state.out1 !== null) stack.push(state.out1);
            } else if (state.kind === 'epsilon') {
                if (state.out !== null) stack.push(state.out);
            } else if (
                assertionMatches(state.assertion, position, characters) &&
                state.out !== null
            ) {
                stack.push(state.out);
            }
        }

        if (accepted) return true;
        if (position === characters.length) return false;

        carry = [];
        for (const stateIndex of consuming) {
            const state = pattern.states[stateIndex];
            if (
                state.kind === 'character' &&
                state.out !== null &&
                matchesCharacter(
                    state.matcher,
                    characters[position],
                    foldedCharacters[position],
                )
            ) {
                carry.push(state.out);
            }
        }
    }
    return false;
};

const compilePattern = (pattern: string): CompiledPattern => {
    const safePattern = compileSafePattern(pattern);
    return {
        safePattern,
        literal: safePattern === null ? foldCase(pattern) : '',
    };
};

export const compileFilterRules = (
    rules: SubscriptionFilterRules,
): CompiledSubscriptionFilterRules => ({
    title: rules.excludeTitle.map(compilePattern),
    content: rules.excludeContent.map(compilePattern),
    author: rules.excludeAuthor.map(compilePattern),
});

const matches = (
    patterns: readonly CompiledPattern[],
    value: string,
): boolean =>
    patterns.some((pattern) =>
        pattern.safePattern === null
            ? foldCase(value).includes(pattern.literal)
            : matchesSafePattern(pattern.safePattern, value),
    );

export const matchesSubscriptionFilter = (
    candidate: FilterCandidate,
    rules: CompiledSubscriptionFilterRules,
): boolean =>
    matches(rules.title, candidate.title) ||
    matches(rules.content, candidate.contentHtml ?? '') ||
    matches(rules.author, candidate.author ?? '');
