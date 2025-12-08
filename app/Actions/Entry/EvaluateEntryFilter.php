<?php

declare(strict_types=1);

namespace App\Actions\Entry;

use App\Models\Entry;
use Lorisleiva\Actions\Concerns\AsAction;

class EvaluateEntryFilter
{
    use AsAction;

    /**
     * Check if an entry should be filtered (hidden) based on filter rules.
     *
     * Filter rules format:
     * [
     *     'exclude_title' => ['alpha', 'beta', 'rc\d+'],  // Regex patterns to exclude by title
     *     'exclude_content' => ['sponsored'],             // Regex patterns to exclude by content
     *     'exclude_author' => ['bot'],                    // Regex patterns to exclude by author
     * ]
     *
     * @param  array<string, array<string>>|null  $filterRules
     * @return bool True if the entry should be filtered (hidden), false otherwise
     */
    public function handle(Entry $entry, ?array $filterRules): bool
    {
        if ($filterRules === null || $filterRules === []) {
            return false;
        }

        // Check title exclusions
        if (isset($filterRules['exclude_title'])) {
            foreach ($filterRules['exclude_title'] as $pattern) {
                if ($this->matchesPattern($entry->title, $pattern)) {
                    return true;
                }
            }
        }

        // Check content exclusions
        if (isset($filterRules['exclude_content'])) {
            foreach ($filterRules['exclude_content'] as $pattern) {
                if ($this->matchesPattern($entry->content, $pattern)) {
                    return true;
                }
            }
        }

        // Check author exclusions
        if (isset($filterRules['exclude_author'])) {
            foreach ($filterRules['exclude_author'] as $pattern) {
                if ($this->matchesPattern($entry->author, $pattern)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Check if text matches a pattern (case-insensitive).
     * The pattern is treated as a regex if valid, otherwise as a literal substring.
     */
    private function matchesPattern(?string $text, string $pattern): bool
    {
        if ($text === null || $text === '') {
            return false;
        }

        // Try to use the pattern as a regex first
        $regexPattern = '/'.$pattern.'/i';

        // Suppress warnings for invalid regex patterns
        if (@preg_match($regexPattern, '') === false) {
            // Invalid regex, fall back to case-insensitive substring match
            return stripos($text, $pattern) !== false;
        }

        return preg_match($regexPattern, $text) === 1;
    }
}
