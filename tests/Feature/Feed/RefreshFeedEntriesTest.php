<?php

declare(strict_types=1);

namespace Tests\Feature\Feed;

use App\Actions\Feed\RefreshFeedEntries;
use App\Exceptions\FeedCrawlFailedException;
use App\Models\Feed;
use App\Models\FeedRefresh;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery;
use SimplePie\Item;
use Tests\TestCase;

class RefreshFeedEntriesTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        parent::tearDown();

        Mockery::close();
    }

    public function test_it_records_successful_refresh_attempts(): void
    {
        $feed = Feed::factory()->create();

        $author = Mockery::mock();
        $author->shouldReceive('get_name')->andReturn('Author');

        $item = Mockery::mock(Item::class);
        $item->shouldReceive('get_permalink')->andReturn('https://example.com/article');
        $item->shouldReceive('get_title')->andReturn('Example article');
        $item->shouldReceive('get_author')->andReturn($author);
        $item->shouldReceive('get_content')->andReturn('<p>Content</p>');
        $item->shouldReceive('get_date')->with('Y-m-d H:i:s')->andReturn(now()->format('Y-m-d H:i:s'));

        $crawledFeed = Mockery::mock();
        $crawledFeed->shouldReceive('error')->andReturnFalse();
        $crawledFeed->shouldReceive('get_items')->andReturn([$item]);

        \Feeds::shouldReceive('make')->once()->andReturn($crawledFeed);

        RefreshFeedEntries::run($feed);

        $this->assertDatabaseHas('feed_refreshes', [
            'feed_id' => $feed->id,
            'was_successful' => true,
            'entries_created' => 1,
            'error_message' => null,
        ]);

        $feed->refresh();

        $this->assertNotNull($feed->last_successful_refresh_at);
        $this->assertNull($feed->last_error_message);
        $this->assertTrue($feed->refreshes()->exists());
    }

    public function test_it_records_failed_refresh_attempts(): void
    {
        $feed = Feed::factory()->create();

        $errorMessage = 'Connection timeout: '.str_repeat('x', 300);

        $crawledFeed = Mockery::mock();
        $crawledFeed->shouldReceive('error')->andReturn($errorMessage);

        \Feeds::shouldReceive('make')->once()->andReturn($crawledFeed);

        $this->expectException(FeedCrawlFailedException::class);

        try {
            RefreshFeedEntries::run($feed);
        } finally {
            $this->assertDatabaseHas('feed_refreshes', [
                'feed_id' => $feed->id,
                'was_successful' => false,
            ]);

            $this->assertSame(1, FeedRefresh::query()->count());

            $feed->refresh();

            $this->assertSame(255, strlen($feed->last_error_message));
            $this->assertDatabaseHas('feed_refreshes', [
                'feed_id' => $feed->id,
                'error_message' => $errorMessage,
            ]);
        }
    }
}
