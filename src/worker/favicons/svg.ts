import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';

import { FaviconSourceError, prepareFaviconSource } from './source';

const MAX_SANITIZED_SVG_BYTES = 64 * 1024;
const MAX_NODES = 4_096;
const MAX_ATTRIBUTES = 8_192;
const MAX_DEPTH = 64;
const MAX_TEXT_LENGTH = 8_192;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const parserOptions = {
    allowBooleanAttributes: false,
    attributeNamePrefix: '',
    ignoreAttributes: false,
    ignoreDeclaration: true,
    ignorePiTags: true,
    parseAttributeValue: false,
    parseTagValue: false,
    preserveOrder: true,
    processEntities: false,
} as const;

const parser = new XMLParser(parserOptions);
const builder = new XMLBuilder({
    ...parserOptions,
    format: false,
    suppressEmptyNode: true,
});

const elements = new Map(
    [
        'svg',
        'g',
        'path',
        'rect',
        'circle',
        'ellipse',
        'line',
        'polyline',
        'polygon',
        'defs',
        'linearGradient',
        'radialGradient',
        'stop',
        'clipPath',
        'mask',
        'pattern',
        'symbol',
        'use',
        'style',
        'title',
        'desc',
        'text',
        'tspan',
    ].map((name) => [name.toLowerCase(), name]),
);

const attributeNames = [
    'xmlns',
    'xmlns:xlink',
    'viewBox',
    'width',
    'height',
    'x',
    'y',
    'x1',
    'y1',
    'x2',
    'y2',
    'cx',
    'cy',
    'r',
    'rx',
    'ry',
    'fx',
    'fy',
    'fr',
    'd',
    'points',
    'transform',
    'preserveAspectRatio',
    'fill',
    'fill-opacity',
    'fill-rule',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'stroke-dasharray',
    'stroke-dashoffset',
    'stroke-opacity',
    'opacity',
    'color',
    'vector-effect',
    'shape-rendering',
    'color-interpolation',
    'display',
    'visibility',
    'id',
    'class',
    'style',
    'gradientUnits',
    'gradientTransform',
    'spreadMethod',
    'offset',
    'stop-color',
    'stop-opacity',
    'clip-path',
    'clip-rule',
    'mask',
    'maskUnits',
    'maskContentUnits',
    'patternUnits',
    'patternContentUnits',
    'patternTransform',
    'href',
    'xlink:href',
    'font-family',
    'font-size',
    'font-style',
    'font-weight',
    'text-anchor',
    'dominant-baseline',
    'enable-background',
] as const;
const attributes = new Map(
    attributeNames.map((name) => [name.toLowerCase(), name]),
);

const styleProperties = new Map(
    [
        'fill',
        'fill-opacity',
        'fill-rule',
        'stroke',
        'stroke-width',
        'stroke-linecap',
        'stroke-linejoin',
        'stroke-miterlimit',
        'stroke-dasharray',
        'stroke-dashoffset',
        'stroke-opacity',
        'opacity',
        'color',
        'vector-effect',
        'shape-rendering',
        'color-interpolation',
        'display',
        'visibility',
        'stop-color',
        'stop-opacity',
        'clip-path',
        'clip-rule',
        'mask',
        'font-family',
        'font-size',
        'font-style',
        'font-weight',
        'text-anchor',
        'dominant-baseline',
        'enable-background',
    ].map((name) => [name, name]),
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const safeLocalReferences = (value: string): boolean => {
    if (!value.toLowerCase().includes('url(')) return true;
    const withoutLocalReferences = value.replace(
        /url\(\s*['"]?#[A-Za-z_][A-Za-z0-9:._-]{0,127}['"]?\s*\)/giu,
        '',
    );
    return !/url\s*\(/iu.test(withoutLocalReferences);
};

const hasUnsafeControlCharacter = (value: string): boolean =>
    Array.from(value).some((character) => {
        const code = character.codePointAt(0) ?? 0;
        return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    });

const safeValue = (value: string): boolean =>
    value.length <= 32_768 &&
    !/[&"<>`\\]/u.test(value) &&
    !hasUnsafeControlCharacter(value) &&
    !/(?:javascript|vbscript)\s*:/iu.test(value) &&
    !/expression\s*\(/iu.test(value) &&
    !/@import\b/iu.test(value) &&
    safeLocalReferences(value);

const safeCssValue = (value: string): boolean =>
    safeValue(value) &&
    !/\b(?:image|image-set|cross-fade|element|src)\s*\(/iu.test(value) &&
    !/(?:^|["'\s(])\/{2}/u.test(value);

const sanitizeStyle = (value: string): string | null => {
    if (!safeCssValue(value)) return null;
    const declarations: string[] = [];
    for (const declaration of value.split(';')) {
        const separator = declaration.indexOf(':');
        if (separator < 1) continue;
        const property = declaration.slice(0, separator).trim().toLowerCase();
        const canonical = styleProperties.get(property);
        const propertyValue = declaration.slice(separator + 1).trim();
        if (
            canonical === undefined ||
            propertyValue.length === 0 ||
            !safeValue(propertyValue)
        ) {
            continue;
        }
        declarations.push(`${canonical}:${propertyValue}`);
    }
    return declarations.length === 0 ? null : declarations.join(';');
};

const sanitizeStylesheet = (value: string): string | null => {
    if (
        value.length > MAX_TEXT_LENGTH ||
        /[@\\<>]/u.test(value) ||
        !safeValue(value)
    ) {
        return null;
    }
    const rules: string[] = [];
    const rulePattern = /([^{}]+)\{([^{}]*)\}/gu;
    let consumed = '';
    for (const match of value.matchAll(rulePattern)) {
        const selector = (match[1] ?? '').trim();
        const declarations = sanitizeStyle(match[2] ?? '');
        if (
            !/^(?:[.#]?[A-Za-z_][A-Za-z0-9_-]*)(?:\s*,\s*[.#]?[A-Za-z_][A-Za-z0-9_-]*)*$/u.test(
                selector,
            ) ||
            declarations === null
        ) {
            continue;
        }
        rules.push(`${selector}{${declarations}}`);
        consumed += match[0];
    }
    if (
        value.replace(rulePattern, '').trim().length > 0 ||
        consumed.length === 0
    )
        return null;
    return rules.length === 0 ? null : rules.join('');
};

const sanitizeAttribute = (
    name: string,
    value: unknown,
): readonly [string, string] | null => {
    const canonical = attributes.get(name.toLowerCase());
    if (canonical === undefined || typeof value !== 'string') return null;
    const normalized = value.trim();
    if (canonical === 'xmlns')
        return normalized === SVG_NAMESPACE ? [canonical, normalized] : null;
    if (canonical === 'xmlns:xlink')
        return normalized === 'http://www.w3.org/1999/xlink'
            ? [canonical, normalized]
            : null;
    if (!safeValue(normalized)) return null;
    if (canonical === 'href' || canonical === 'xlink:href')
        return /^#[A-Za-z_][A-Za-z0-9:._-]{0,127}$/u.test(normalized)
            ? [canonical, normalized]
            : null;
    if (canonical === 'id')
        return /^[A-Za-z_][A-Za-z0-9:._-]{0,127}$/u.test(normalized)
            ? [canonical, normalized]
            : null;
    if (canonical === 'class')
        return /^[A-Za-z_][A-Za-z0-9_-]*(?:\s+[A-Za-z_][A-Za-z0-9_-]*)*$/u.test(
            normalized,
        )
            ? [canonical, normalized]
            : null;
    if (canonical === 'style') {
        const style = sanitizeStyle(normalized);
        return style === null ? null : [canonical, style];
    }
    if (
        styleProperties.has(canonical.toLowerCase()) &&
        !safeCssValue(normalized)
    )
        return null;
    return [canonical, normalized];
};

export const sanitizeSvg = async (source: Uint8Array): Promise<Uint8Array> => {
    const prepared = await prepareFaviconSource(source);
    if (prepared.kind !== 'svg') throw new FaviconSourceError('unsupported');

    let parsed: unknown;
    try {
        const text = new TextDecoder().decode(prepared.bytes);
        if (XMLValidator.validate(text) !== true)
            throw new FaviconSourceError('invalid');
        parsed = parser.parse(text);
    } catch {
        throw new FaviconSourceError('invalid');
    }
    if (!Array.isArray(parsed)) throw new FaviconSourceError('invalid');

    let nodeCount = 0;
    let attributeCount = 0;
    const sanitizeNodes = (
        nodes: unknown,
        depth: number,
        parent: string | null,
    ): Record<string, unknown>[] => {
        if (!Array.isArray(nodes) || depth > MAX_DEPTH)
            throw new FaviconSourceError('invalid');
        const output: Record<string, unknown>[] = [];
        for (const rawNode of nodes) {
            if (!isRecord(rawNode)) continue;
            if ('#text' in rawNode) {
                const text = rawNode['#text'];
                if (typeof text !== 'string' || text.trim().length === 0)
                    continue;
                const sanitizedText =
                    parent === 'style'
                        ? sanitizeStylesheet(text)
                        : ['title', 'desc', 'text', 'tspan'].includes(
                                parent ?? '',
                            ) &&
                            text.length <= MAX_TEXT_LENGTH &&
                            safeValue(text)
                          ? text
                          : null;
                if (sanitizedText !== null)
                    output.push({ '#text': sanitizedText });
                continue;
            }

            const names = Object.keys(rawNode).filter((name) => name !== ':@');
            if (names.length !== 1) continue;
            const originalName = names[0];
            if (originalName === undefined) continue;
            const canonical = elements.get(originalName.toLowerCase());
            if (canonical === undefined) continue;
            nodeCount += 1;
            if (nodeCount > MAX_NODES) throw new FaviconSourceError('invalid');

            const node: Record<string, unknown> = {
                [canonical]: sanitizeNodes(
                    rawNode[originalName],
                    depth + 1,
                    canonical,
                ),
            };
            const rawAttributes = rawNode[':@'];
            if (isRecord(rawAttributes)) {
                const sanitizedAttributes: Record<string, string> = {};
                for (const [name, value] of Object.entries(rawAttributes)) {
                    attributeCount += 1;
                    if (attributeCount > MAX_ATTRIBUTES)
                        throw new FaviconSourceError('invalid');
                    const attribute = sanitizeAttribute(name, value);
                    if (attribute !== null)
                        sanitizedAttributes[attribute[0]] = attribute[1];
                }
                if (Object.keys(sanitizedAttributes).length > 0)
                    node[':@'] = sanitizedAttributes;
            }
            output.push(node);
        }
        return output;
    };

    const sanitized = sanitizeNodes(parsed, 0, null).filter((node) =>
        Object.hasOwn(node, 'svg'),
    );
    if (sanitized.length !== 1 || Object.keys(sanitized[0] ?? {}).length > 2)
        throw new FaviconSourceError('invalid');
    const root = sanitized[0];
    if (root === undefined) throw new FaviconSourceError('invalid');
    const rootAttributes = isRecord(root[':@']) ? root[':@'] : {};
    root[':@'] = { ...rootAttributes, xmlns: SVG_NAMESPACE };

    const result = new TextEncoder().encode(builder.build(sanitized));
    if (result.byteLength === 0 || result.byteLength > MAX_SANITIZED_SVG_BYTES)
        throw new FaviconSourceError('invalid');
    return result;
};
