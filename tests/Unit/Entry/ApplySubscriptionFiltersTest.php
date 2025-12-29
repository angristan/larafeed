<?php

declare(strict_types=1);

namespace Tests\Unit\Entry;

use App\Actions\Entry\ApplySubscriptionFilters;
use App\Models\Entry;
use App\Models\EntryInteraction;
use App\Models\Feed;
use App\Models\FeedSubscription;
use App\Models\SubscriptionCategory;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ApplySubscriptionFiltersTest extends TestCase
{
    use RefreshDatabase;

    public function test_marks_matching_entries_as_filtered(): void
    {
        $user = User::factory()->create();
        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);
        $feed = Feed::factory()->create();

        $user->feeds()->attach($feed, [
            'category_id' => $category->id,
            'filter_rules' => json_encode(['exclude_title' => ['alpha']]),
        ]);

        $entry = Entry::factory()->create([
            'feed_id' => $feed->id,
            'title' => 'v1.0.0-alpha.1 Release',
        ]);

        $subscription = FeedSubscription::where('user_id', $user->id)
            ->where('feed_id', $feed->id)
            ->first();

        $action = new ApplySubscriptionFilters;
        $action->handle($subscription, collect([$entry]));

        $interaction = EntryInteraction::where('user_id', $user->id)
            ->where('entry_id', $entry->id)
            ->first();

        $this->assertNotNull($interaction);
        $this->assertNotNull($interaction->filtered_at);
    }

    public function test_does_not_filter_non_matching_entries(): void
    {
        $user = User::factory()->create();
        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);
        $feed = Feed::factory()->create();

        $user->feeds()->attach($feed, [
            'category_id' => $category->id,
            'filter_rules' => json_encode(['exclude_title' => ['alpha']]),
        ]);

        $entry = Entry::factory()->create([
            'feed_id' => $feed->id,
            'title' => 'v1.0.0 Stable Release',
        ]);

        $subscription = FeedSubscription::where('user_id', $user->id)
            ->where('feed_id', $feed->id)
            ->first();

        $action = new ApplySubscriptionFilters;
        $action->handle($subscription, collect([$entry]));

        $interaction = EntryInteraction::where('user_id', $user->id)
            ->where('entry_id', $entry->id)
            ->first();

        $this->assertTrue($interaction === null || $interaction->filtered_at === null);
    }

    public function test_unfilters_previously_filtered_entries_when_rules_change(): void
    {
        $user = User::factory()->create();
        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);
        $feed = Feed::factory()->create();

        $user->feeds()->attach($feed, [
            'category_id' => $category->id,
            'filter_rules' => json_encode(['exclude_title' => ['beta']]), // Changed from alpha
        ]);

        $entry = Entry::factory()->create([
            'feed_id' => $feed->id,
            'title' => 'v1.0.0-alpha.1 Release',
        ]);

        // Pre-create a filtered interaction
        EntryInteraction::create([
            'user_id' => $user->id,
            'entry_id' => $entry->id,
            'filtered_at' => now(),
        ]);

        $subscription = FeedSubscription::where('user_id', $user->id)
            ->where('feed_id', $feed->id)
            ->first();

        $action = new ApplySubscriptionFilters;
        $action->handle($subscription, collect([$entry]));

        $interaction = EntryInteraction::where('user_id', $user->id)
            ->where('entry_id', $entry->id)
            ->first();

        // Should be unfiltered since "alpha" no longer matches the new "beta" rule
        $this->assertNull($interaction->filtered_at);
    }

    public function test_handles_empty_entries_collection(): void
    {
        $user = User::factory()->create();
        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);
        $feed = Feed::factory()->create();

        $user->feeds()->attach($feed, [
            'category_id' => $category->id,
            'filter_rules' => json_encode(['exclude_title' => ['alpha']]),
        ]);

        $subscription = FeedSubscription::where('user_id', $user->id)
            ->where('feed_id', $feed->id)
            ->first();

        $action = new ApplySubscriptionFilters;
        // Should not throw exception
        $action->handle($subscription, collect([]));

        $this->assertSame(0, EntryInteraction::count());
    }

    public function test_fetches_all_entries_when_no_entries_provided(): void
    {
        $user = User::factory()->create();
        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);
        $feed = Feed::factory()->create();

        $user->feeds()->attach($feed, [
            'category_id' => $category->id,
            'filter_rules' => json_encode(['exclude_title' => ['alpha']]),
        ]);

        $alphaEntry = Entry::factory()->create([
            'feed_id' => $feed->id,
            'title' => 'v1.0.0-alpha.1 Release',
        ]);

        $stableEntry = Entry::factory()->create([
            'feed_id' => $feed->id,
            'title' => 'v1.0.0 Stable Release',
        ]);

        $subscription = FeedSubscription::where('user_id', $user->id)
            ->where('feed_id', $feed->id)
            ->first();

        $action = new ApplySubscriptionFilters;
        $action->handle($subscription, null); // null = fetch all entries

        // Alpha entry should be filtered
        $alphaInteraction = EntryInteraction::where('user_id', $user->id)
            ->where('entry_id', $alphaEntry->id)
            ->first();
        $this->assertNotNull($alphaInteraction);
        $this->assertNotNull($alphaInteraction->filtered_at);

        // Stable entry should not be filtered
        $stableInteraction = EntryInteraction::where('user_id', $user->id)
            ->where('entry_id', $stableEntry->id)
            ->first();
        $this->assertTrue($stableInteraction === null || $stableInteraction->filtered_at === null);
    }

    public function test_for_new_entries_applies_filters_to_all_subscribers(): void
    {
        $user1 = User::factory()->create();
        $user2 = User::factory()->create();

        $category1 = SubscriptionCategory::create(['user_id' => $user1->id, 'name' => 'Tech']);
        $category2 = SubscriptionCategory::create(['user_id' => $user2->id, 'name' => 'Tech']);

        $feed = Feed::factory()->create();

        $user1->feeds()->attach($feed, [
            'category_id' => $category1->id,
            'filter_rules' => json_encode(['exclude_title' => ['alpha']]),
        ]);

        $user2->feeds()->attach($feed, [
            'category_id' => $category2->id,
            'filter_rules' => json_encode(['exclude_title' => ['beta']]),
        ]);

        $alphaEntry = Entry::factory()->create([
            'feed_id' => $feed->id,
            'title' => 'v1.0.0-alpha.1 Release',
        ]);

        $betaEntry = Entry::factory()->create([
            'feed_id' => $feed->id,
            'title' => 'v1.0.0-beta.1 Release',
        ]);

        $action = new ApplySubscriptionFilters;
        $action->forNewEntries($feed->id, collect([$alphaEntry, $betaEntry]));

        // User1 should have alpha filtered
        $user1AlphaInteraction = EntryInteraction::where('user_id', $user1->id)
            ->where('entry_id', $alphaEntry->id)
            ->first();
        $this->assertNotNull($user1AlphaInteraction?->filtered_at);

        // User1 should NOT have beta filtered
        $user1BetaInteraction = EntryInteraction::where('user_id', $user1->id)
            ->where('entry_id', $betaEntry->id)
            ->first();
        $this->assertTrue($user1BetaInteraction === null || $user1BetaInteraction->filtered_at === null);

        // User2 should NOT have alpha filtered
        $user2AlphaInteraction = EntryInteraction::where('user_id', $user2->id)
            ->where('entry_id', $alphaEntry->id)
            ->first();
        $this->assertTrue($user2AlphaInteraction === null || $user2AlphaInteraction->filtered_at === null);

        // User2 should have beta filtered
        $user2BetaInteraction = EntryInteraction::where('user_id', $user2->id)
            ->where('entry_id', $betaEntry->id)
            ->first();
        $this->assertNotNull($user2BetaInteraction?->filtered_at);
    }

    public function test_for_new_entries_skips_empty_collection(): void
    {
        $user = User::factory()->create();
        $category = SubscriptionCategory::create(['user_id' => $user->id, 'name' => 'Tech']);
        $feed = Feed::factory()->create();

        $user->feeds()->attach($feed, [
            'category_id' => $category->id,
            'filter_rules' => json_encode(['exclude_title' => ['alpha']]),
        ]);

        $action = new ApplySubscriptionFilters;
        // Should not throw or do anything
        $action->forNewEntries($feed->id, collect([]));

        $this->assertSame(0, EntryInteraction::count());
    }

    public function test_handles_json_string_filter_rules(): void
    {
        $user = User::factory()->create();
        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);
        $feed = Feed::factory()->create();

        // Manually insert with JSON string to test the JSON decode path
        FeedSubscription::insert([
            'user_id' => $user->id,
            'feed_id' => $feed->id,
            'category_id' => $category->id,
            'filter_rules' => '{"exclude_title":["alpha"]}',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $entry = Entry::factory()->create([
            'feed_id' => $feed->id,
            'title' => 'v1.0.0-alpha.1 Release',
        ]);

        $subscription = FeedSubscription::where('user_id', $user->id)
            ->where('feed_id', $feed->id)
            ->first();

        $action = new ApplySubscriptionFilters;
        $action->handle($subscription, collect([$entry]));

        $interaction = EntryInteraction::where('user_id', $user->id)
            ->where('entry_id', $entry->id)
            ->first();

        $this->assertNotNull($interaction);
        $this->assertNotNull($interaction->filtered_at);
    }
}
