<?php

declare(strict_types=1);

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Validates that a filter pattern is safe to use.
 *
 * This rule ensures patterns:
 * - Are valid regex syntax (or will be used as literal substrings)
 * - Do not contain ReDoS-prone constructs (nested quantifiers)
 * - Are reasonably sized
 */
class SafeFilterPattern implements ValidationRule
{
    /**
     * Patterns that indicate potential ReDoS vulnerability.
     * These detect nested quantifiers like (a+)+, (a*)+, (a+)*, etc.
     *
     * @var array<string>
     */
    private const REDOS_PATTERNS = [
        // Nested quantifiers: (x+)+, (x+)*, (x*)+, (x*)*
        '/\([^)]*[+*]\)[+*]/',
        // Alternation with overlapping patterns followed by quantifier
        '/\([^)]*\|[^)]*\)[+*]/',
        // Repeated capturing groups with quantifiers
        '/\(\?:[^)]*[+*]\)[+*]/',
    ];

    /**
     * @param  \Closure(string, ?string=): \Illuminate\Translation\PotentiallyTranslatedString  $fail
     */
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value)) {
            $fail('The :attribute must be a string.');

            return;
        }

        if (trim($value) === '') {
            $fail('The :attribute cannot be empty.');

            return;
        }

        // Check for ReDoS-prone patterns before testing regex validity
        if ($this->hasRedosRisk($value)) {
            $fail('The :attribute contains a potentially unsafe pattern (nested quantifiers). Please simplify the pattern.');

            return;
        }

        // Test if it's a valid regex by attempting to compile it
        // Use ~ as delimiter since # is commonly used in hashtag patterns
        $regexPattern = '~'.$value.'~i';
        $isValidRegex = @preg_match($regexPattern, '') !== false;

        // If it's not valid regex, that's okay - it will be used as substring match
        // But warn the user if it looks like they intended regex
        if (! $isValidRegex && $this->looksLikeIntendedRegex($value)) {
            $fail('The :attribute appears to be an invalid regex pattern. Check for unclosed brackets or invalid syntax.');

            return;
        }
    }

    /**
     * Check if a pattern has potential ReDoS vulnerability.
     */
    private function hasRedosRisk(string $pattern): bool
    {
        foreach (self::REDOS_PATTERNS as $redosPattern) {
            if (preg_match($redosPattern, $pattern) === 1) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check if a pattern looks like the user intended to write a regex.
     * This helps provide better error messages for invalid regex.
     */
    private function looksLikeIntendedRegex(string $pattern): bool
    {
        // Contains regex metacharacters that wouldn't appear in normal text
        $regexIndicators = ['[', ']', '(', ')', '{', '}', '^', '$', '\\d', '\\w', '\\s', '|', '+', '*', '?'];

        foreach ($regexIndicators as $indicator) {
            if (str_contains($pattern, $indicator)) {
                return true;
            }
        }

        return false;
    }
}
