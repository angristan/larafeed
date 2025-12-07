<?php

declare(strict_types=1);

namespace Tests\Feature\Reader;

use App\Models\Entry;
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
}
