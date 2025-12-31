import queryString, { type ParsedQuery } from 'query-string';

/**
 * Parse the current URL's query string into an object
 */
export function getUrlParams(): ParsedQuery<string> {
    return queryString.parse(window.location.search);
}

/**
 * Stringify an object into a query string (without leading ?)
 */
export function stringifyParams(
    params: Record<string, unknown>,
    options?: queryString.StringifyOptions,
): string {
    return queryString.stringify(params, {
        arrayFormat: 'bracket',
        skipNull: true,
        skipEmptyString: true,
        ...options,
    });
}

/**
 * Get a specific parameter from the current URL
 */
export function getUrlParam(key: string): string | null {
    const params = getUrlParams();
    const value = params[key];
    if (Array.isArray(value)) {
        return value[0] ?? null;
    }
    return value ?? null;
}
