import { Schema } from 'effect';

export class HealthResponse extends Schema.Class<HealthResponse>(
    'HealthResponse',
)({
    status: Schema.Literal('ok'),
}) {}
