<?php

declare(strict_types=1);

namespace Tests\Unit\Feed;

use App\Actions\Feed\RecordFeedRefresh;
use App\Models\Feed;
use App\Models\FeedRefresh;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RecordFeedRefreshTest extends TestCase
{
    use RefreshDatabase;

    public function test_records_successful_refresh(): void
    {
        $feed = Feed::factory()->create();
        $timestamp = now();

        $action = new RecordFeedRefresh;
        $action->handle($feed, $timestamp, success: true, entriesCreated: 5);

        $feed->refresh();

        $this->assertNotNull($feed->last_successful_refresh_at);
        $this->assertNull($feed->last_error_message);

        $this->assertDatabaseHas('feed_refreshes', [
            'feed_id' => $feed->id,
            'was_successful' => true,
            'entries_created' => 5,
            'error_message' => null,
        ]);
    }

    public function test_records_failed_refresh(): void
    {
        $feed = Feed::factory()->create();
        $timestamp = now();

        $action = new RecordFeedRefresh;
        $action->handle($feed, $timestamp, success: false, entriesCreated: 0, error: 'Connection timeout');

        $feed->refresh();

        $this->assertNotNull($feed->last_failed_refresh_at);
        $this->assertSame('Connection timeout', $feed->last_error_message);

        $this->assertDatabaseHas('feed_refreshes', [
            'feed_id' => $feed->id,
            'was_successful' => false,
            'entries_created' => 0,
            'error_message' => 'Connection timeout',
        ]);
    }

    public function test_clears_error_message_on_successful_refresh(): void
    {
        $feed = Feed::factory()->create([
            'last_error_message' => 'Previous error',
        ]);
        $timestamp = now();

        $action = new RecordFeedRefresh;
        $action->handle($feed, $timestamp, success: true, entriesCreated: 3);

        $feed->refresh();

        $this->assertNull($feed->last_error_message);
    }

    public function test_truncates_long_error_messages(): void
    {
        $feed = Feed::factory()->create();
        $timestamp = now();
        $longError = str_repeat('x', 300);

        $action = new RecordFeedRefresh;
        $action->handle($feed, $timestamp, success: false, entriesCreated: 0, error: $longError);

        $feed->refresh();

        $this->assertSame(255, strlen($feed->last_error_message));
    }

    public function test_creates_feed_refresh_record(): void
    {
        $feed = Feed::factory()->create();
        $timestamp = now();

        $action = new RecordFeedRefresh;
        $action->handle($feed, $timestamp, success: true, entriesCreated: 10);

        $this->assertSame(1, FeedRefresh::count());

        $refresh = FeedRefresh::first();
        $this->assertSame($feed->id, $refresh->feed_id);
        $this->assertSame(10, $refresh->entries_created);
        $this->assertTrue($refresh->was_successful);
    }

    public function test_handles_null_error(): void
    {
        $feed = Feed::factory()->create();
        $timestamp = now();

        $action = new RecordFeedRefresh;
        $action->handle($feed, $timestamp, success: false, entriesCreated: 0, error: null);

        $feed->refresh();

        $this->assertSame('', $feed->last_error_message);
    }
}
