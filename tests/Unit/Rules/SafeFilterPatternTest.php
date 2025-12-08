<?php

declare(strict_types=1);

namespace Tests\Unit\Rules;

use App\Rules\SafeFilterPattern;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class SafeFilterPatternTest extends TestCase
{
    private SafeFilterPattern $rule;

    protected function setUp(): void
    {
        parent::setUp();
        $this->rule = new SafeFilterPattern;
    }

    #[DataProvider('validPatternsProvider')]
    public function test_passes_on_valid_patterns(string $pattern): void
    {
        $failed = false;

        $this->rule->validate(
            'filter_pattern',
            $pattern,
            function () use (&$failed) {
                $failed = true;
            }
        );

        $this->assertFalse($failed, "Validation should pass for: {$pattern}");
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function validPatternsProvider(): array
    {
        return [
            // Simple substring patterns
            'simple word' => ['alpha'],
            'word with dash' => ['alpha-release'],
            'multiple words' => ['sponsored content'],

            // Valid regex patterns
            'alternation' => ['alpha|beta|rc'],
            'character class' => ['v[0-9]+'],
            'digit shorthand' => ['rc\d+'],
            'word boundary' => ['\bsponsored\b'],
            'optional char' => ['colours?'],
            'simple quantifier' => ['a+'],
            'dot star' => ['.*release'],
            'anchors' => ['^alpha'],
            'case insensitive already' => ['[Aa]lpha'],

            // Real-world filter patterns
            'semver prerelease' => ['-(alpha|beta|rc)\.\d+'],
            'github bot author' => ['dependabot'],
            'sponsored content' => ['#ad|#sponsored'],
        ];
    }

    #[DataProvider('invalidPatternsProvider')]
    public function test_fails_on_invalid_patterns(mixed $pattern, string $expectedErrorContains): void
    {
        $failed = false;
        $errorMessage = null;

        $this->rule->validate(
            'filter_pattern',
            $pattern,
            function (string $message) use (&$failed, &$errorMessage) {
                $failed = true;
                $errorMessage = $message;
            }
        );

        $this->assertTrue($failed, 'Validation should fail for: '.var_export($pattern, true));
        $this->assertNotNull($errorMessage);
        $this->assertStringContainsString($expectedErrorContains, $errorMessage);
    }

    /**
     * @return array<string, array{0: mixed, 1: string}>
     */
    public static function invalidPatternsProvider(): array
    {
        return [
            // Non-string values
            'integer' => [123, 'must be a string'],
            'array' => [['alpha'], 'must be a string'],
            'null' => [null, 'must be a string'],

            // Empty patterns
            'empty string' => ['', 'cannot be empty'],
            'whitespace only' => ['   ', 'cannot be empty'],

            // ReDoS patterns - nested quantifiers
            'nested plus' => ['(a+)+', 'nested quantifiers'],
            'nested star' => ['(a*)*', 'nested quantifiers'],
            'mixed nested' => ['(a+)*', 'nested quantifiers'],
            'nested with content' => ['(foo+)+', 'nested quantifiers'],
            'alternation with quantifier' => ['(a|b)+', 'nested quantifiers'],
            'non-capturing nested' => ['(?:a+)+', 'nested quantifiers'],

            // Invalid regex that looks intentional
            'unclosed bracket' => ['[abc', 'invalid regex'],
            'unclosed paren' => ['(abc', 'invalid regex'],
        ];
    }

    public function test_allows_valid_character_class(): void
    {
        // [test] is valid regex - matches any single character: t, e, s, or t
        $failed = false;

        $this->rule->validate(
            'filter_pattern',
            '[test]',
            function () use (&$failed) {
                $failed = true;
            }
        );

        $this->assertFalse($failed);
    }

    public function test_allows_plain_text_with_special_meaning(): void
    {
        // Plain text that happens to contain regex-like chars but is valid
        $failed = false;

        $this->rule->validate(
            'filter_pattern',
            'C++',
            function () use (&$failed) {
                $failed = true;
            }
        );

        // C++ contains + but is valid regex (matches C followed by one or more plus signs)
        $this->assertFalse($failed);
    }
}
