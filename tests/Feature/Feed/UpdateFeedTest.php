<?php

declare(strict_types=1);

namespace Tests\Feature\Feed;

use App\Models\Feed;
use App\Models\SubscriptionCategory;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class UpdateFeedTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_update_feed_custom_name(): void
    {
        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $feed = Feed::factory()->create(['name' => 'Original Name']);
        $user->feeds()->attach($feed->id, ['category_id' => $category->id]);

        $this->actingAs($user);

        $response = $this->patch(route('feed.update', ['feed_id' => $feed->id]), [
            'name' => 'Custom Name',
        ]);

        $response->assertRedirect();

        $this->assertDatabaseHas('feed_subscriptions', [
            'user_id' => $user->id,
            'feed_id' => $feed->id,
            'custom_feed_name' => 'Custom Name',
        ]);
    }

    public function test_user_can_clear_custom_name(): void
    {
        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $feed = Feed::factory()->create(['name' => 'Original Name']);
        $user->feeds()->attach($feed->id, [
            'category_id' => $category->id,
            'custom_feed_name' => 'Custom Name',
        ]);

        $this->actingAs($user);

        $response = $this->patch(route('feed.update', ['feed_id' => $feed->id]), [
            'name' => '',
        ]);

        $response->assertRedirect();

        $this->assertDatabaseHas('feed_subscriptions', [
            'user_id' => $user->id,
            'feed_id' => $feed->id,
            'custom_feed_name' => null,
        ]);
    }

    public function test_user_can_change_feed_category(): void
    {
        $user = User::factory()->create();

        $category1 = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $category2 = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'News',
        ]);

        $feed = Feed::factory()->create();
        $user->feeds()->attach($feed->id, ['category_id' => $category1->id]);

        $this->actingAs($user);

        $response = $this->patch(route('feed.update', ['feed_id' => $feed->id]), [
            'category_id' => $category2->id,
        ]);

        $response->assertRedirect();

        $this->assertDatabaseHas('feed_subscriptions', [
            'user_id' => $user->id,
            'feed_id' => $feed->id,
            'category_id' => $category2->id,
        ]);
    }

    public function test_user_cannot_change_to_another_users_category(): void
    {
        $user1 = User::factory()->create();
        $user2 = User::factory()->create();

        $category1 = SubscriptionCategory::create([
            'user_id' => $user1->id,
            'name' => 'Tech',
        ]);

        $category2 = SubscriptionCategory::create([
            'user_id' => $user2->id,
            'name' => 'News',
        ]);

        $feed = Feed::factory()->create();
        $user1->feeds()->attach($feed->id, ['category_id' => $category1->id]);

        $this->actingAs($user1);

        $response = $this->patch(route('feed.update', ['feed_id' => $feed->id]), [
            'category_id' => $category2->id,
        ]);

        $response->assertSessionHasErrors();

        $this->assertDatabaseHas('feed_subscriptions', [
            'user_id' => $user1->id,
            'feed_id' => $feed->id,
            'category_id' => $category1->id,
        ]);
    }

    public function test_user_cannot_update_unsubscribed_feed(): void
    {
        $user = User::factory()->create();
        $feed = Feed::factory()->create();

        $this->actingAs($user);

        $response = $this->patch(route('feed.update', ['feed_id' => $feed->id]), [
            'name' => 'Custom Name',
        ]);

        $response->assertSessionHasErrors();
    }

    public function test_name_max_length_is_255(): void
    {
        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $feed = Feed::factory()->create();
        $user->feeds()->attach($feed->id, ['category_id' => $category->id]);

        $this->actingAs($user);

        $response = $this->patch(route('feed.update', ['feed_id' => $feed->id]), [
            'name' => str_repeat('a', 256),
        ]);

        $response->assertSessionHasErrors('name');
    }

    public function test_unauthenticated_user_cannot_update_feed(): void
    {
        $feed = Feed::factory()->create();

        $response = $this->patch(route('feed.update', ['feed_id' => $feed->id]), [
            'name' => 'Custom Name',
        ]);

        $response->assertRedirect(route('login'));
    }

    public function test_name_not_persisted_when_category_validation_fails(): void
    {
        $user1 = User::factory()->create();
        $user2 = User::factory()->create();

        $category1 = SubscriptionCategory::create([
            'user_id' => $user1->id,
            'name' => 'Tech',
        ]);

        $category2 = SubscriptionCategory::create([
            'user_id' => $user2->id,
            'name' => 'News',
        ]);

        $feed = Feed::factory()->create();
        $user1->feeds()->attach($feed->id, ['category_id' => $category1->id]);

        $this->actingAs($user1);

        // Send both name and invalid category_id
        $response = $this->patch(route('feed.update', ['feed_id' => $feed->id]), [
            'name' => 'New Custom Name',
            'category_id' => $category2->id,
        ]);

        $response->assertSessionHasErrors();

        // Verify name was NOT changed (atomic - all or nothing)
        $this->assertDatabaseHas('feed_subscriptions', [
            'user_id' => $user1->id,
            'feed_id' => $feed->id,
            'category_id' => $category1->id,
            'custom_feed_name' => null,
        ]);
    }

    public function test_user_can_set_filter_rules(): void
    {
        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $feed = Feed::factory()->create();
        $user->feeds()->attach($feed->id, ['category_id' => $category->id]);

        $this->actingAs($user);

        $response = $this->patch(route('feed.update', ['feed_id' => $feed->id]), [
            'filter_rules' => [
                'exclude_title' => ['alpha', 'beta'],
            ],
        ]);

        $response->assertRedirect();

        $subscription = $user->feeds()->where('feeds.id', $feed->id)->first()->subscription;
        $this->assertEquals(['exclude_title' => ['alpha', 'beta']], $subscription->filter_rules);
    }

    public function test_user_can_clear_filter_rules(): void
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

        $this->actingAs($user);

        $response = $this->patch(route('feed.update', ['feed_id' => $feed->id]), [
            'filter_rules' => [
                'exclude_title' => [],
            ],
        ]);

        $response->assertRedirect();

        $subscription = $user->feeds()->where('feeds.id', $feed->id)->first()->subscription;
        $this->assertNull($subscription->filter_rules);
    }

    public function test_filter_rules_are_applied_to_existing_entries(): void
    {
        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $feed = Feed::factory()->create();
        $user->feeds()->attach($feed->id, ['category_id' => $category->id]);

        // Create entries
        $alphaEntry = $feed->entries()->create([
            'title' => 'v1.0.0-alpha.1',
            'url' => 'https://example.com/alpha',
            'published_at' => now(),
        ]);

        $stableEntry = $feed->entries()->create([
            'title' => 'v1.0.0 Stable',
            'url' => 'https://example.com/stable',
            'published_at' => now(),
        ]);

        $this->actingAs($user);

        // Set filter to exclude alpha releases
        $response = $this->patch(route('feed.update', ['feed_id' => $feed->id]), [
            'filter_rules' => [
                'exclude_title' => ['alpha'],
            ],
        ]);

        $response->assertRedirect();

        // Alpha entry should be filtered
        $this->assertDatabaseHas('entry_interactions', [
            'user_id' => $user->id,
            'entry_id' => $alphaEntry->id,
        ]);

        $alphaInteraction = \App\Models\EntryInteraction::where('user_id', $user->id)
            ->where('entry_id', $alphaEntry->id)
            ->first();
        $this->assertNotNull($alphaInteraction->filtered_at);

        // Stable entry should NOT be filtered
        $stableInteraction = \App\Models\EntryInteraction::where('user_id', $user->id)
            ->where('entry_id', $stableEntry->id)
            ->first();
        $this->assertTrue($stableInteraction === null || $stableInteraction->filtered_at === null);
    }

    public function test_removing_filter_rules_unfilters_entries(): void
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

        // Create an entry that matches the filter
        $alphaEntry = $feed->entries()->create([
            'title' => 'v1.0.0-alpha.1',
            'url' => 'https://example.com/alpha',
            'published_at' => now(),
        ]);

        // Mark it as filtered
        \App\Models\EntryInteraction::create([
            'user_id' => $user->id,
            'entry_id' => $alphaEntry->id,
            'filtered_at' => now(),
        ]);

        $this->actingAs($user);

        // Remove the filter rules
        $response = $this->patch(route('feed.update', ['feed_id' => $feed->id]), [
            'filter_rules' => [
                'exclude_title' => [],
            ],
        ]);

        $response->assertRedirect();

        // The entry should now be unfiltered
        $alphaInteraction = \App\Models\EntryInteraction::where('user_id', $user->id)
            ->where('entry_id', $alphaEntry->id)
            ->first();
        $this->assertNull($alphaInteraction->filtered_at);
    }

    public function test_changing_filter_rules_re_evaluates_entries(): void
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

        // Create entries
        $alphaEntry = $feed->entries()->create([
            'title' => 'v1.0.0-alpha.1',
            'url' => 'https://example.com/alpha',
            'published_at' => now(),
        ]);

        $betaEntry = $feed->entries()->create([
            'title' => 'v1.0.0-beta.1',
            'url' => 'https://example.com/beta',
            'published_at' => now(),
        ]);

        // Mark alpha as filtered (simulating previous filter application)
        \App\Models\EntryInteraction::create([
            'user_id' => $user->id,
            'entry_id' => $alphaEntry->id,
            'filtered_at' => now(),
        ]);

        $this->actingAs($user);

        // Change filter from alpha to beta
        $response = $this->patch(route('feed.update', ['feed_id' => $feed->id]), [
            'filter_rules' => [
                'exclude_title' => ['beta'],
            ],
        ]);

        $response->assertRedirect();

        // Alpha should now be unfiltered
        $alphaInteraction = \App\Models\EntryInteraction::where('user_id', $user->id)
            ->where('entry_id', $alphaEntry->id)
            ->first();
        $this->assertNull($alphaInteraction->filtered_at);

        // Beta should now be filtered
        $betaInteraction = \App\Models\EntryInteraction::where('user_id', $user->id)
            ->where('entry_id', $betaEntry->id)
            ->first();
        $this->assertNotNull($betaInteraction);
        $this->assertNotNull($betaInteraction->filtered_at);
    }

    public function test_rejects_redos_prone_patterns(): void
    {
        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $feed = Feed::factory()->create();
        $user->feeds()->attach($feed->id, ['category_id' => $category->id]);

        $this->actingAs($user);

        $response = $this->patch(route('feed.update', ['feed_id' => $feed->id]), [
            'filter_rules' => [
                'exclude_title' => ['(a+)+'], // ReDoS pattern
            ],
        ]);

        $response->assertSessionHasErrors('filter_rules.exclude_title.0');
    }

    public function test_rejects_invalid_regex_patterns(): void
    {
        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $feed = Feed::factory()->create();
        $user->feeds()->attach($feed->id, ['category_id' => $category->id]);

        $this->actingAs($user);

        $response = $this->patch(route('feed.update', ['feed_id' => $feed->id]), [
            'filter_rules' => [
                'exclude_title' => ['[unclosed'], // Invalid regex
            ],
        ]);

        $response->assertSessionHasErrors('filter_rules.exclude_title.0');
    }

    public function test_accepts_valid_regex_patterns(): void
    {
        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $feed = Feed::factory()->create();
        $user->feeds()->attach($feed->id, ['category_id' => $category->id]);

        $this->actingAs($user);

        $response = $this->patch(route('feed.update', ['feed_id' => $feed->id]), [
            'filter_rules' => [
                'exclude_title' => ['alpha|beta', 'rc\d+'],
                'exclude_content' => ['#sponsored'],
            ],
        ]);

        $response->assertRedirect();
        $response->assertSessionHasNoErrors();

        $subscription = $user->feeds()->where('feeds.id', $feed->id)->first()->subscription;
        $this->assertEquals([
            'exclude_title' => ['alpha|beta', 'rc\d+'],
            'exclude_content' => ['#sponsored'],
        ], $subscription->filter_rules);
    }
}
