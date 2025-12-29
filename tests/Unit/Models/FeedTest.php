<?php

declare(strict_types=1);

namespace Tests\Unit\Models;

use App\Models\Entry;
use App\Models\Feed;
use App\Models\FeedRefresh;
use App\Models\SubscriptionCategory;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FeedTest extends TestCase
{
    use RefreshDatabase;

    public function test_feed_has_entries_relationship(): void
    {
        $feed = Feed::factory()->create();
        $entry = Entry::factory()->create(['feed_id' => $feed->id]);

        $this->assertTrue($feed->entries()->exists());
        $this->assertSame($entry->id, $feed->entries()->first()->id);
    }

    public function test_feed_has_refreshes_relationship(): void
    {
        $feed = Feed::factory()->create();
        FeedRefresh::create([
            'feed_id' => $feed->id,
            'refreshed_at' => now(),
            'was_successful' => true,
            'entries_created' => 5,
        ]);

        $this->assertTrue($feed->refreshes()->exists());
    }

    public function test_feed_has_users_relationship(): void
    {
        $user = User::factory()->create();
        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);
        $feed = Feed::factory()->create();

        $user->feeds()->attach($feed, ['category_id' => $category->id]);

        $this->assertTrue($feed->users()->exists());
        $this->assertSame($user->id, $feed->users()->first()->id);
    }

    public function test_feed_scope_for_user(): void
    {
        $user = User::factory()->create();
        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $subscribedFeed = Feed::factory()->create();
        $unsubscribedFeed = Feed::factory()->create();

        $user->feeds()->attach($subscribedFeed, ['category_id' => $category->id]);

        $userFeeds = Feed::forUser($user)->get();

        $this->assertCount(1, $userFeeds);
        $this->assertSame($subscribedFeed->id, $userFeeds->first()->id);
    }

    public function test_feed_casts_datetime_fields(): void
    {
        $feed = Feed::factory()->create([
            'last_successful_refresh_at' => '2024-01-15 10:30:00',
            'last_failed_refresh_at' => '2024-01-14 08:00:00',
            'favicon_updated_at' => '2024-01-13 12:00:00',
        ]);

        $this->assertInstanceOf(\Illuminate\Support\Carbon::class, $feed->last_successful_refresh_at);
        $this->assertInstanceOf(\Illuminate\Support\Carbon::class, $feed->last_failed_refresh_at);
        $this->assertInstanceOf(\Illuminate\Support\Carbon::class, $feed->favicon_updated_at);
    }

    public function test_feed_casts_favicon_is_dark_to_boolean(): void
    {
        $feed = Feed::factory()->create([
            'favicon_is_dark' => 1,
        ]);

        $this->assertTrue($feed->favicon_is_dark);

        $feed2 = Feed::factory()->create([
            'favicon_is_dark' => 0,
        ]);

        $this->assertFalse($feed2->favicon_is_dark);
    }

    public function test_feed_fillable_attributes(): void
    {
        $feed = Feed::create([
            'name' => 'Test Feed',
            'feed_url' => 'https://example.com/feed.xml',
            'site_url' => 'https://example.com',
            'favicon_url' => 'https://example.com/favicon.ico',
            'favicon_is_dark' => true,
            'favicon_updated_at' => now(),
            'last_successful_refresh_at' => now(),
            'last_failed_refresh_at' => now(),
            'last_error_message' => 'Test error',
        ]);

        $this->assertSame('Test Feed', $feed->name);
        $this->assertSame('https://example.com/feed.xml', $feed->feed_url);
        $this->assertSame('Test error', $feed->last_error_message);
    }
}
