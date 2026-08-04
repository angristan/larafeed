import type { ChartRequest } from './api/charts';

const DAY_MS = 24 * 60 * 60_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const ranges = new Set(['30', '90', '365', 'custom']);

const utcToday = (now: number): number => {
    const value = new Date(now);
    return Date.UTC(
        value.getUTCFullYear(),
        value.getUTCMonth(),
        value.getUTCDate(),
    );
};
const date = (timestamp: number): string =>
    new Date(timestamp).toISOString().slice(0, 10);
const safeId = (value: string | null): number | null => {
    if (value === null || !/^[1-9]\d*$/u.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
};
const dateTimestamp = (value: string | null): number | null => {
    if (value === null || !DATE_PATTERN.test(value)) return null;
    const parsed = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed) && date(parsed) === value ? parsed : null;
};

export function defaultCustomDates(now: number): {
    readonly startDate: string;
    readonly endDate: string;
} {
    const today = utcToday(now);
    return { startDate: date(today - 29 * DAY_MS), endDate: date(today) };
}

export function parseChartState(
    parameters: URLSearchParams,
    now = Date.now(),
): ChartRequest {
    const rangeValue = parameters.get('range') ?? '30';
    const range = ranges.has(rangeValue)
        ? (rangeValue as ChartRequest['range'])
        : '30';
    const feedId = safeId(parameters.get('feed') ?? parameters.get('feedId'));
    const categoryId =
        feedId === null
            ? safeId(parameters.get('category') ?? parameters.get('categoryId'))
            : null;
    const defaults = defaultCustomDates(now);
    let startDate: string | null = null;
    let endDate: string | null = null;
    if (range === 'custom') {
        const start = dateTimestamp(
            parameters.get('start') ?? parameters.get('startDate'),
        );
        const end = dateTimestamp(
            parameters.get('end') ?? parameters.get('endDate'),
        );
        const today = utcToday(now);
        if (
            start !== null &&
            end !== null &&
            end >= start &&
            end <= today &&
            (end - start) / DAY_MS + 1 <= 366
        ) {
            startDate = date(start);
            endDate = date(end);
        } else {
            startDate = defaults.startDate;
            endDate = defaults.endDate;
        }
    }
    return { range, feedId, categoryId, startDate, endDate };
}

export function canonicalChartSearch(input: ChartRequest): string {
    const parameters = new URLSearchParams();
    if (input.range !== '30') parameters.set('range', input.range);
    if (input.feedId !== null) parameters.set('feed', String(input.feedId));
    else if (input.categoryId !== null)
        parameters.set('category', String(input.categoryId));
    if (
        input.range === 'custom' &&
        input.startDate !== null &&
        input.endDate !== null
    ) {
        parameters.set('start', input.startDate);
        parameters.set('end', input.endDate);
    }
    return parameters.toString();
}
