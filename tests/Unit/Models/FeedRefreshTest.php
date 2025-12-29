<?php

declare(strict_types=1);

namespace Tests\Unit\Models;

use App\Models\Feed;
use App\Models\FeedRefresh;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FeedRefreshTest extends TestCase
{
    use RefreshDatabase;

    public function test_feed_refresh_belongs_to_feed(): void
    {
        $feed = Feed::factory()->create();
        $refresh = FeedRefresh::create([
            'feed_id' => $feed->id,
            'refreshed_at' => now(),
            'was_successful' => true,
            'entries_created' => 5,
        ]);

        $this->assertSame($feed->id, $refresh->feed->id);
    }

    public function test_feed_refresh_casts_refreshed_at_to_datetime(): void
    {
        $feed = Feed::factory()->create();
        $refresh = FeedRefresh::create([
            'feed_id' => $feed->id,
            'refreshed_at' => '2024-01-15 10:30:00',
            'was_successful' => true,
            'entries_created' => 0,
        ]);

        $this->assertInstanceOf(\Illuminate\Support\Carbon::class, $refresh->refreshed_at);
    }

    public function test_feed_refresh_casts_was_successful_to_boolean(): void
    {
        $feed = Feed::factory()->create();

        $successfulRefresh = FeedRefresh::create([
            'feed_id' => $feed->id,
            'refreshed_at' => now(),
            'was_successful' => 1,
            'entries_created' => 5,
        ]);

        $this->assertTrue($successfulRefresh->was_successful);

        $failedRefresh = FeedRefresh::create([
            'feed_id' => $feed->id,
            'refreshed_at' => now(),
            'was_successful' => 0,
            'entries_created' => 0,
            'error_message' => 'Connection timeout',
        ]);

        $this->assertFalse($failedRefresh->was_successful);
    }

    public function test_feed_refresh_stores_error_message(): void
    {
        $feed = Feed::factory()->create();
        $refresh = FeedRefresh::create([
            'feed_id' => $feed->id,
            'refreshed_at' => now(),
            'was_successful' => false,
            'entries_created' => 0,
            'error_message' => 'Connection timeout: server not responding',
        ]);

        $this->assertSame('Connection timeout: server not responding', $refresh->error_message);
    }

    public function test_feed_refresh_fillable_attributes(): void
    {
        $feed = Feed::factory()->create();
        $refresh = FeedRefresh::create([
            'feed_id' => $feed->id,
            'refreshed_at' => now(),
            'was_successful' => true,
            'entries_created' => 10,
            'error_message' => null,
        ]);

        $this->assertSame($feed->id, $refresh->feed_id);
        $this->assertSame(10, $refresh->entries_created);
        $this->assertNull($refresh->error_message);
    }
}
