import { Schema } from 'effect';

/*
 * Tool input schemas, sent to the client in every conversation. Effect's
 * JSON Schema output nests each check in its own `allOf` member and states
 * the safe-integer bound on every ID; flattening that cuts the tool list by
 * about a third without changing what it accepts.
 */

type JsonObject = { [key: string]: unknown };

const isObject = (value: unknown): value is JsonObject =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/** Flattens `allOf` checks and drops bounds that carry no information. */
export const compactJsonSchema = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(compactJsonSchema);
    if (!isObject(node)) return node;

    let result: JsonObject = {};
    for (const [key, value] of Object.entries(node)) {
        if (key === 'allOf') continue;
        if (key === 'properties' && isObject(value)) {
            result.properties = Object.fromEntries(
                Object.entries(value).map(([name, schema]) => [
                    name,
                    compactJsonSchema(schema),
                ]),
            );
            continue;
        }
        result[key] = compactJsonSchema(value);
    }
    const checks = node.allOf;
    if (Array.isArray(checks) && checks.every(isObject)) {
        // Checks only add keywords (minimum, maxItems, description), so
        // merging them into the parent keeps the same meaning.
        for (const check of checks) {
            result = { ...result, ...(compactJsonSchema(check) as JsonObject) };
        }
    } else if (checks !== undefined) {
        result.allOf = compactJsonSchema(checks);
    }
    if (result.maximum === Number.MAX_SAFE_INTEGER) delete result.maximum;
    return result;
};

/**
 * Exposes an Effect schema to the MCP SDK: Standard Schema validation for the
 * arguments, and compact JSON Schema for the published tool list.
 */
export const toolInput = <S extends Schema.ConstraintDecoder<unknown>>(
    schema: S,
) => {
    const standard = Schema.toStandardJSONSchemaV1(
        Schema.toStandardSchemaV1(schema),
    );
    const props = standard['~standard'];
    return {
        '~standard': {
            ...props,
            jsonSchema: {
                input: (
                    options: Parameters<typeof props.jsonSchema.input>[0],
                ) =>
                    compactJsonSchema(
                        props.jsonSchema.input(options),
                    ) as ReturnType<typeof props.jsonSchema.input>,
                output: (
                    options: Parameters<typeof props.jsonSchema.output>[0],
                ) =>
                    compactJsonSchema(
                        props.jsonSchema.output(options),
                    ) as ReturnType<typeof props.jsonSchema.output>,
            },
        },
    } as unknown as typeof standard;
};
