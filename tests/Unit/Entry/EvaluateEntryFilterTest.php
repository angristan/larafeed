<?php

declare(strict_types=1);

namespace Tests\Unit\Entry;

use App\Actions\Entry\EvaluateEntryFilter;
use App\Models\Entry;
use PHPUnit\Framework\TestCase;

class EvaluateEntryFilterTest extends TestCase
{
    private EvaluateEntryFilter $action;

    protected function setUp(): void
    {
        parent::setUp();
        $this->action = new EvaluateEntryFilter;
    }

    public function test_returns_false_when_no_filter_rules(): void
    {
        $entry = $this->createEntry('Test Title', 'Test content', 'Author');

        $result = $this->action->handle($entry, null);

        $this->assertFalse($result);
    }

    public function test_returns_false_when_empty_filter_rules(): void
    {
        $entry = $this->createEntry('Test Title', 'Test content', 'Author');

        $result = $this->action->handle($entry, []);

        $this->assertFalse($result);
    }

    public function test_filters_entry_by_title_substring(): void
    {
        $entry = $this->createEntry('v1.0.0-alpha.1 Release', 'Release notes', 'Admin');

        $result = $this->action->handle($entry, [
            'exclude_title' => ['alpha'],
        ]);

        $this->assertTrue($result);
    }

    public function test_filters_entry_by_title_regex(): void
    {
        $entry = $this->createEntry('v1.0.0-rc.2 Release', 'Release notes', 'Admin');

        $result = $this->action->handle($entry, [
            'exclude_title' => ['rc\.\d+'],
        ]);

        $this->assertTrue($result);
    }

    public function test_filters_entry_by_title_regex_alternative(): void
    {
        $entry = $this->createEntry('v1.0.0-beta.1 Release', 'Release notes', 'Admin');

        $result = $this->action->handle($entry, [
            'exclude_title' => ['alpha|beta|rc'],
        ]);

        $this->assertTrue($result);
    }

    public function test_does_not_filter_when_title_does_not_match(): void
    {
        $entry = $this->createEntry('v1.0.0 Stable Release', 'Release notes', 'Admin');

        $result = $this->action->handle($entry, [
            'exclude_title' => ['alpha', 'beta', 'rc\.\d+'],
        ]);

        $this->assertFalse($result);
    }

    public function test_filters_entry_by_content(): void
    {
        $entry = $this->createEntry('News Update', 'This is a sponsored post', 'Editor');

        $result = $this->action->handle($entry, [
            'exclude_content' => ['sponsored'],
        ]);

        $this->assertTrue($result);
    }

    public function test_filters_entry_by_author(): void
    {
        $entry = $this->createEntry('Auto Post', 'Some content', 'AutoBot');

        $result = $this->action->handle($entry, [
            'exclude_author' => ['bot'],
        ]);

        $this->assertTrue($result);
    }

    public function test_filter_is_case_insensitive(): void
    {
        $entry = $this->createEntry('ALPHA Release', 'Content', 'Author');

        $result = $this->action->handle($entry, [
            'exclude_title' => ['alpha'],
        ]);

        $this->assertTrue($result);
    }

    public function test_handles_null_content_gracefully(): void
    {
        $entry = $this->createEntry('Title', null, 'Author');

        $result = $this->action->handle($entry, [
            'exclude_content' => ['test'],
        ]);

        $this->assertFalse($result);
    }

    public function test_handles_null_author_gracefully(): void
    {
        $entry = $this->createEntry('Title', 'Content', null);

        $result = $this->action->handle($entry, [
            'exclude_author' => ['test'],
        ]);

        $this->assertFalse($result);
    }

    public function test_invalid_regex_falls_back_to_substring_match(): void
    {
        $entry = $this->createEntry('Title with [brackets]', 'Content', 'Author');

        // Invalid regex pattern (unclosed bracket) should fall back to substring match
        $result = $this->action->handle($entry, [
            'exclude_title' => ['[brackets]'],
        ]);

        $this->assertTrue($result);
    }

    public function test_multiple_rules_across_fields(): void
    {
        $entry = $this->createEntry('Normal Title', 'Sponsored content', 'Human');

        $result = $this->action->handle($entry, [
            'exclude_title' => ['alpha'],
            'exclude_content' => ['sponsored'],
            'exclude_author' => ['bot'],
        ]);

        // Should match because content contains "sponsored"
        $this->assertTrue($result);
    }

    private function createEntry(string $title, ?string $content, ?string $author): Entry
    {
        $entry = new Entry;
        $entry->title = $title;
        $entry->content = $content;
        $entry->author = $author;

        return $entry;
    }
}
