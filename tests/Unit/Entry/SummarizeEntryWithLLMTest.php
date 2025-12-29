<?php

declare(strict_types=1);

namespace Tests\Unit\Entry;

use App\Actions\Entry\SummarizeEntryWithLLM;
use App\Models\Entry;
use App\Models\Feed;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class SummarizeEntryWithLLMTest extends TestCase
{
    use RefreshDatabase;

    public function test_returns_cached_summary_without_calling_llm(): void
    {
        $feed = Feed::factory()->create();
        $entry = Entry::factory()->create([
            'feed_id' => $feed->id,
            'content' => '<p>This is a long article.</p>',
        ]);

        // Pre-populate cache
        Cache::put("entry_{$entry->id}_llm_summary", '<p>Pre-cached summary.</p>', now()->addDays(30));

        $action = new SummarizeEntryWithLLM;
        $summary = $action->handle($entry);

        $this->assertSame('<p>Pre-cached summary.</p>', $summary);
    }

    public function test_cache_key_is_entry_specific(): void
    {
        $feed = Feed::factory()->create();
        $entry1 = Entry::factory()->create(['feed_id' => $feed->id]);
        $entry2 = Entry::factory()->create(['feed_id' => $feed->id]);

        Cache::put("entry_{$entry1->id}_llm_summary", 'Summary 1', now()->addDays(30));
        Cache::put("entry_{$entry2->id}_llm_summary", 'Summary 2', now()->addDays(30));

        $action = new SummarizeEntryWithLLM;

        $this->assertSame('Summary 1', $action->handle($entry1));
        $this->assertSame('Summary 2', $action->handle($entry2));
    }
}
