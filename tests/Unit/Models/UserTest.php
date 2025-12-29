<?php

declare(strict_types=1);

namespace Tests\Unit\Models;

use App\Models\Entry;
use App\Models\EntryInteraction;
use App\Models\Feed;
use App\Models\SubscriptionCategory;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class UserTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_has_feeds_relationship(): void
    {
        $user = User::factory()->create();
        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);
        $feed = Feed::factory()->create();

        $user->feeds()->attach($feed, ['category_id' => $category->id]);

        $this->assertTrue($user->feeds()->exists());
        $this->assertSame($feed->id, $user->feeds()->first()->id);
    }

    public function test_user_has_entries_interacted_relationship(): void
    {
        $user = User::factory()->create();
        $feed = Feed::factory()->create();
        $entry = Entry::factory()->create(['feed_id' => $feed->id]);

        EntryInteraction::create([
            'user_id' => $user->id,
            'entry_id' => $entry->id,
            'read_at' => now(),
        ]);

        $this->assertTrue($user->entriesInterracted()->exists());
        $this->assertSame($entry->id, $user->entriesInterracted()->first()->id);
    }

    public function test_user_has_subscription_categories_relationship(): void
    {
        $user = User::factory()->create();
        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $this->assertTrue($user->subscriptionCategories()->exists());
        $this->assertSame($category->id, $user->subscriptionCategories()->first()->id);
    }

    public function test_user_hides_password_in_serialization(): void
    {
        $user = User::factory()->create([
            'password' => 'secret_password',
        ]);

        $array = $user->toArray();

        $this->assertArrayNotHasKey('password', $array);
        $this->assertArrayNotHasKey('remember_token', $array);
    }

    public function test_user_password_is_hashed(): void
    {
        $user = User::factory()->create([
            'password' => 'plain_password',
        ]);

        $this->assertNotSame('plain_password', $user->password);
        $this->assertTrue(password_verify('plain_password', $user->password));
    }

    public function test_user_can_have_fever_api_key(): void
    {
        $user = User::factory()->create([
            'fever_api_key' => 'test_fever_key',
        ]);

        $this->assertSame('test_fever_key', $user->fever_api_key);
    }

    public function test_user_feeds_relationship_includes_pivot_data(): void
    {
        $user = User::factory()->create();
        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);
        $feed = Feed::factory()->create();

        $user->feeds()->attach($feed, [
            'category_id' => $category->id,
            'custom_feed_name' => 'My Custom Name',
            'filter_rules' => json_encode(['exclude_title' => ['alpha']]),
        ]);

        $userFeed = $user->feeds()->first();

        $this->assertSame('My Custom Name', $userFeed->subscription->custom_feed_name);
    }
}
