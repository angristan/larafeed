<?php

declare(strict_types=1);

namespace Tests\Feature\Reader;

use App\Models\Entry;
use App\Models\EntryInteraction;
use App\Models\Feed;
use App\Models\SubscriptionCategory;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ShowFeedReaderTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_cannot_view_entry_from_unsubscribed_feed(): void
    {
        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        // Create a feed the user IS subscribed to
        $subscribedFeed = Feed::factory()->create();
        $user->feeds()->attach($subscribedFeed->id, ['category_id' => $category->id]);

        // Create a feed and entry the user is NOT subscribed to
        $otherFeed = Feed::factory()->create();
        $otherEntry = Entry::factory()->create(['feed_id' => $otherFeed->id]);

        $this->actingAs($user);

        $response = $this->get(route('feeds.index', ['entry' => $otherEntry->id]));

        $response->assertOk();

        // The currententry should be null since user doesn't have access
        $this->assertNull($response->viewData('page')['props']['currententry']);
    }

    public function test_user_can_view_entry_from_subscribed_feed(): void
    {
        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $feed = Feed::factory()->create();
        $user->feeds()->attach($feed->id, ['category_id' => $category->id]);

        $entry = Entry::factory()->create(['feed_id' => $feed->id]);

        $this->actingAs($user);

        $response = $this->get(route('feeds.index', ['entry' => $entry->id]));

        $response->assertOk();

        // The currententry should contain the entry
        $currentEntry = $response->viewData('page')['props']['currententry'];
        $this->assertNotNull($currentEntry);
        $this->assertEquals($entry->id, $currentEntry['id']);
    }

    public function test_user_cannot_get_summary_for_entry_from_unsubscribed_feed(): void
    {
        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        // Create a feed the user IS subscribed to
        $subscribedFeed = Feed::factory()->create();
        $user->feeds()->attach($subscribedFeed->id, ['category_id' => $category->id]);

        // Create a feed and entry the user is NOT subscribed to
        $otherFeed = Feed::factory()->create();
        $otherEntry = Entry::factory()->create(['feed_id' => $otherFeed->id]);

        $this->actingAs($user);

        $response = $this->get(route('feeds.index', [
            'entry' => $otherEntry->id,
            'summarize' => 'true',
        ]));

        $response->assertOk();

        // The summary should be null since user doesn't have access
        $this->assertNull($response->viewData('page')['props']['summary']);
    }

    public function test_unauthenticated_user_cannot_access_reader(): void
    {
        $response = $this->get(route('feeds.index'));

        $response->assertRedirect(route('login'));
    }

    public function test_filtered_entries_are_excluded_from_entry_list(): void
    {
        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $feed = Feed::factory()->create();
        $user->feeds()->attach($feed->id, ['category_id' => $category->id]);

        // Create two entries
        $visibleEntry = Entry::factory()->create([
            'feed_id' => $feed->id,
            'title' => 'Stable Release v1.0.0',
        ]);

        $filteredEntry = Entry::factory()->create([
            'feed_id' => $feed->id,
            'title' => 'Alpha Release v1.0.0-alpha.1',
        ]);

        // Mark one entry as filtered
        EntryInteraction::create([
            'user_id' => $user->id,
            'entry_id' => $filteredEntry->id,
            'filtered_at' => now(),
        ]);

        $this->actingAs($user);

        $response = $this->get(route('feeds.index'));

        $response->assertOk();

        $entries = $response->viewData('page')['props']['entries']['data'];

        // Only the visible entry should be in the list
        $this->assertCount(1, $entries);
        $this->assertEquals($visibleEntry->id, $entries[0]['id']);
    }

    public function test_filtered_entries_excluded_from_unread_count(): void
    {
        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $feed = Feed::factory()->create();
        $user->feeds()->attach($feed->id, ['category_id' => $category->id]);

        // Create three entries
        Entry::factory()->create(['feed_id' => $feed->id, 'title' => 'Entry 1']);
        Entry::factory()->create(['feed_id' => $feed->id, 'title' => 'Entry 2']);
        $filteredEntry = Entry::factory()->create(['feed_id' => $feed->id, 'title' => 'Filtered']);

        // Mark one entry as filtered
        EntryInteraction::create([
            'user_id' => $user->id,
            'entry_id' => $filteredEntry->id,
            'filtered_at' => now(),
        ]);

        $this->actingAs($user);

        $response = $this->get(route('feeds.index'));

        $response->assertOk();

        // Unread count should be 2 (excluding the filtered entry)
        $unreadCount = $response->viewData('page')['props']['unreadEntriesCount'];
        $this->assertEquals(2, $unreadCount);
    }

    public function test_feed_entry_count_excludes_filtered_entries(): void
    {
        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $feed = Feed::factory()->create();
        $user->feeds()->attach($feed->id, ['category_id' => $category->id]);

        // Create three entries
        Entry::factory()->create(['feed_id' => $feed->id]);
        Entry::factory()->create(['feed_id' => $feed->id]);
        $filteredEntry = Entry::factory()->create(['feed_id' => $feed->id]);

        // Mark one entry as filtered
        EntryInteraction::create([
            'user_id' => $user->id,
            'entry_id' => $filteredEntry->id,
            'filtered_at' => now(),
        ]);

        $this->actingAs($user);

        $response = $this->get(route('feeds.index'));

        $response->assertOk();

        $feeds = $response->viewData('page')['props']['feeds'];
        $feedData = collect($feeds)->firstWhere('id', $feed->id);

        // Entry count should be 2 (excluding the filtered entry)
        $this->assertEquals(2, $feedData['entries_count']);
    }

    public function test_multi_user_filter_isolation(): void
    {
        $user1 = User::factory()->create();
        $user2 = User::factory()->create();

        $category1 = SubscriptionCategory::create([
            'user_id' => $user1->id,
            'name' => 'Tech',
        ]);

        $category2 = SubscriptionCategory::create([
            'user_id' => $user2->id,
            'name' => 'Tech',
        ]);

        $feed = Feed::factory()->create();
        $user1->feeds()->attach($feed->id, ['category_id' => $category1->id]);
        $user2->feeds()->attach($feed->id, ['category_id' => $category2->id]);

        // Create an entry
        $entry = Entry::factory()->create([
            'feed_id' => $feed->id,
            'title' => 'Alpha Release',
        ]);

        // User1 has it filtered, User2 does not
        EntryInteraction::create([
            'user_id' => $user1->id,
            'entry_id' => $entry->id,
            'filtered_at' => now(),
        ]);

        // User1 should NOT see the entry
        $this->actingAs($user1);
        $response1 = $this->get(route('feeds.index'));
        $entries1 = $response1->viewData('page')['props']['entries']['data'];
        $this->assertCount(0, $entries1);

        // User2 SHOULD see the entry
        $this->actingAs($user2);
        $response2 = $this->get(route('feeds.index'));
        $entries2 = $response2->viewData('page')['props']['entries']['data'];
        $this->assertCount(1, $entries2);
        $this->assertEquals($entry->id, $entries2[0]['id']);
    }
}
