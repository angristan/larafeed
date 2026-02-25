<?php

declare(strict_types=1);

namespace App\Support;

use Keepsuit\LaravelOpenTelemetry\Facades\Tracer;

/**
 * Unified tracing helper that sets span attributes on both
 * OpenTelemetry and Datadog (when dd-trace-php extension is loaded).
 */
class Tracing
{
    /**
     * Set attributes on the active OTel span and the active DD span (if available).
     *
     * @param  array<string, string|int|float|bool>  $attributes
     */
    public static function setAttributes(array $attributes): void
    {
        $otelSpan = Tracer::activeSpan();
        foreach ($attributes as $key => $value) {
            /** @var non-empty-string $key */
            $otelSpan->setAttribute($key, $value);
        }

        $ddSpan = function_exists('DDTrace\active_span') ? \DDTrace\active_span() : null;
        if ($ddSpan !== null) {
            foreach ($attributes as $key => $value) {
                if (is_int($value) || is_float($value)) {
                    $ddSpan->metrics[$key] = $value;
                } else {
                    $ddSpan->meta[$key] = (string) $value;
                }
            }
        }
    }
}
