import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
    fixtureToNdjson,
    fixtureToSql,
    generateRepresentativeFixture,
    type FixtureProfileName,
    resolveFixtureConfig,
} from '../../worker/benchmarks/fixture';

interface Options {
    profile: FixtureProfileName;
    format: 'sql' | 'ndjson' | 'both';
    output: string | null;
    users?: number;
    feeds?: number;
    entriesPerFeed?: number;
    normalContentBytes?: number;
}

const value = (args: readonly string[], index: number, flag: string): string => {
    const result = args[index + 1];
    if (result === undefined || result.startsWith('--')) {
        throw new Error(`${flag} requires a value`);
    }
    return result;
};

const positiveInteger = (input: string, flag: string): number => {
    const result = Number(input);
    if (!Number.isSafeInteger(result) || result < 1) {
        throw new Error(`${flag} must be a positive safe integer`);
    }
    return result;
};

const parseOptions = (args: readonly string[]): Options => {
    const options: Options = {
        profile: 'ci',
        format: 'both',
        output: 'scripts/cloudflare-validation/output',
    };
    for (let index = 0; index < args.length; index += 1) {
        const flag = args[index];
        switch (flag) {
            case '--profile': {
                const profile = value(args, index, flag);
                if (profile !== 'ci' && profile !== 'large') {
                    throw new Error('--profile must be ci or large');
                }
                options.profile = profile;
                index += 1;
                break;
            }
            case '--format': {
                const format = value(args, index, flag);
                if (format !== 'sql' && format !== 'ndjson' && format !== 'both') {
                    throw new Error('--format must be sql, ndjson, or both');
                }
                options.format = format;
                index += 1;
                break;
            }
            case '--output':
                options.output = value(args, index, flag);
                index += 1;
                break;
            case '--stdout':
                options.output = null;
                break;
            case '--users':
                options.users = positiveInteger(value(args, index, flag), flag);
                index += 1;
                break;
            case '--feeds':
                options.feeds = positiveInteger(value(args, index, flag), flag);
                index += 1;
                break;
            case '--entries-per-feed':
                options.entriesPerFeed = positiveInteger(
                    value(args, index, flag),
                    flag,
                );
                index += 1;
                break;
            case '--normal-content-bytes':
                options.normalContentBytes = positiveInteger(
                    value(args, index, flag),
                    flag,
                );
                index += 1;
                break;
            default:
                throw new Error(`unknown argument: ${String(flag)}`);
        }
    }
    if (options.output === null && options.format === 'both') {
        throw new Error('--stdout requires --format sql or --format ndjson');
    }
    return options;
};

const options = parseOptions(Bun.argv.slice(2));
const fixture = await generateRepresentativeFixture(
    resolveFixtureConfig(options.profile, {
        users: options.users,
        feeds: options.feeds,
        entriesPerFeed: options.entriesPerFeed,
        normalContentBytes: options.normalContentBytes,
    }),
);
const output =
    options.format === 'sql'
        ? fixtureToSql(fixture)
        : options.format === 'ndjson'
          ? fixtureToNdjson(fixture)
          : null;

if (options.output === null) {
    process.stdout.write(output ?? '');
} else if (options.format === 'both') {
    const directory = resolve(options.output);
    await mkdir(directory, { recursive: true });
    const sqlPath = resolve(directory, `${fixture.config.profile}-fixture.sql`);
    const ndjsonPath = resolve(
        directory,
        `${fixture.config.profile}-fixture.ndjson`,
    );
    await Promise.all([
        writeFile(sqlPath, fixtureToSql(fixture)),
        writeFile(ndjsonPath, fixtureToNdjson(fixture)),
    ]);
    console.log(
        JSON.stringify({
            profile: fixture.config.profile,
            expectedCounts: fixture.expectedCounts,
            sqlPath,
            ndjsonPath,
        }),
    );
} else {
    const outputPath = resolve(
        options.output === 'scripts/cloudflare-validation/output'
            ? resolve(
                  options.output,
                  `${fixture.config.profile}-fixture.${options.format}`,
              )
            : options.output,
    );
    await mkdir(resolve(outputPath, '..'), { recursive: true });
    await writeFile(outputPath, output ?? '');
    console.log(
        JSON.stringify({
            profile: fixture.config.profile,
            expectedCounts: fixture.expectedCounts,
            outputPath,
        }),
    );
}
