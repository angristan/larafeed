<?php

declare(strict_types=1);

namespace Tests\Feature\Feed;

use App\Actions\Feed\RefreshFeedEntries;
use App\Exceptions\FeedCrawlFailedException;
use App\Models\EntryInteraction;
use App\Models\Feed;
use App\Models\FeedRefresh;
use App\Models\SubscriptionCategory;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
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

    public function test_user_cannot_refresh_feed_they_are_not_subscribed_to(): void
    {
        $user = User::factory()->create();

        // Create a feed the user is NOT subscribed to
        $otherFeed = Feed::factory()->create();

        $this->actingAs($user);

        $response = $this->post(route('feed.refresh', ['feed_id' => $otherFeed->id]));

        $response->assertStatus(403);
        $response->assertJson(['error' => 'Unauthorized']);
    }

    public function test_user_can_refresh_feed_they_are_subscribed_to(): void
    {
        Queue::fake();

        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $feed = Feed::factory()->create([
            'last_successful_refresh_at' => now()->subMinutes(10),
        ]);
        $user->feeds()->attach($feed->id, ['category_id' => $category->id]);

        $this->actingAs($user);

        $response = $this->post(route('feed.refresh', ['feed_id' => $feed->id]));

        $response->assertStatus(200);
        $response->assertJson(['message' => 'Feed refresh requested']);
    }

    public function test_unauthenticated_user_cannot_refresh_feed(): void
    {
        $feed = Feed::factory()->create();

        $response = $this->post(route('feed.refresh', ['feed_id' => $feed->id]));

        $response->assertRedirect(route('login'));
    }

    public function test_filters_are_applied_to_new_entries_on_refresh(): void
    {
        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $feed = Feed::factory()->create();
        $user->feeds()->attach($feed->id, [
            'category_id' => $category->id,
            'filter_rules' => json_encode(['exclude_title' => ['alpha']]),
        ]);

        // Mock two items: one that should be filtered, one that shouldn't
        $author = Mockery::mock();
        $author->shouldReceive('get_name')->andReturn('Author');

        $alphaItem = Mockery::mock(Item::class);
        $alphaItem->shouldReceive('get_permalink')->andReturn('https://example.com/alpha');
        $alphaItem->shouldReceive('get_title')->andReturn('v1.0.0-alpha.1 Release');
        $alphaItem->shouldReceive('get_author')->andReturn($author);
        $alphaItem->shouldReceive('get_content')->andReturn('<p>Alpha content</p>');
        $alphaItem->shouldReceive('get_date')->with('Y-m-d H:i:s')->andReturn(now()->format('Y-m-d H:i:s'));

        $stableItem = Mockery::mock(Item::class);
        $stableItem->shouldReceive('get_permalink')->andReturn('https://example.com/stable');
        $stableItem->shouldReceive('get_title')->andReturn('v1.0.0 Stable Release');
        $stableItem->shouldReceive('get_author')->andReturn($author);
        $stableItem->shouldReceive('get_content')->andReturn('<p>Stable content</p>');
        $stableItem->shouldReceive('get_date')->with('Y-m-d H:i:s')->andReturn(now()->format('Y-m-d H:i:s'));

        $crawledFeed = Mockery::mock();
        $crawledFeed->shouldReceive('error')->andReturnFalse();
        $crawledFeed->shouldReceive('get_items')->andReturn([$alphaItem, $stableItem]);

        \Feeds::shouldReceive('make')->once()->andReturn($crawledFeed);

        RefreshFeedEntries::run($feed);

        // Both entries should be created
        $this->assertDatabaseHas('entries', ['title' => 'v1.0.0-alpha.1 Release']);
        $this->assertDatabaseHas('entries', ['title' => 'v1.0.0 Stable Release']);

        // Alpha entry should be filtered for the user
        $alphaEntry = $feed->entries()->where('title', 'v1.0.0-alpha.1 Release')->first();
        $alphaInteraction = EntryInteraction::where('user_id', $user->id)
            ->where('entry_id', $alphaEntry->id)
            ->first();
        $this->assertNotNull($alphaInteraction);
        $this->assertNotNull($alphaInteraction->filtered_at);

        // Stable entry should NOT be filtered
        $stableEntry = $feed->entries()->where('title', 'v1.0.0 Stable Release')->first();
        $stableInteraction = EntryInteraction::where('user_id', $user->id)
            ->where('entry_id', $stableEntry->id)
            ->first();
        $this->assertTrue($stableInteraction === null || $stableInteraction->filtered_at === null);
    }
}
