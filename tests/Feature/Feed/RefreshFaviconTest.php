<?php

declare(strict_types=1);

namespace Tests\Feature\Feed;

use App\Models\Feed;
use App\Models\SubscriptionCategory;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class RefreshFaviconTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_cannot_refresh_favicon_for_feed_they_are_not_subscribed_to(): void
    {
        $user = User::factory()->create();

        // Create a feed the user is NOT subscribed to
        $otherFeed = Feed::factory()->create();

        $this->actingAs($user);

        $response = $this->post(route('feed.refresh-favicon', ['feed_id' => $otherFeed->id]));

        $response->assertStatus(401);
        $response->assertJson(['error' => 'Unauthorized']);
    }

    public function test_user_can_refresh_favicon_for_feed_they_are_subscribed_to(): void
    {
        Queue::fake();

        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $feed = Feed::factory()->create();
        $user->feeds()->attach($feed->id, ['category_id' => $category->id]);

        $this->actingAs($user);

        $response = $this->post(route('feed.refresh-favicon', ['feed_id' => $feed->id]));

        $response->assertStatus(200);
        $response->assertJson(['message' => 'Favicon refresh requested']);
    }

    public function test_unauthenticated_user_cannot_refresh_favicon(): void
    {
        $feed = Feed::factory()->create();

        $response = $this->post(route('feed.refresh-favicon', ['feed_id' => $feed->id]));

        $response->assertRedirect(route('login'));
    }
}
