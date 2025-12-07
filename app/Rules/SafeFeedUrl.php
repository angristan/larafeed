<?php

declare(strict_types=1);

namespace App\Rules;

use App\Support\UrlSecurityValidator;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Validates that a URL is safe to fetch (SSRF protection).
 *
 * This rule ensures URLs:
 * - Use only http/https schemes
 * - Do not resolve to private, reserved, or loopback IP addresses
 * - Supports both IPv4 and IPv6 validation
 */
class SafeFeedUrl implements ValidationRule
{
    /**
     * @param  \Closure(string, ?string=): \Illuminate\Translation\PotentiallyTranslatedString  $fail
     */
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value)) {
            $fail('The :attribute must be a string.');

            return;
        }

        $result = UrlSecurityValidator::validate($value);

        if (! $result['valid']) {
            $fail($result['error'] ?? 'The :attribute is not a safe URL.');
        }
    }
}
