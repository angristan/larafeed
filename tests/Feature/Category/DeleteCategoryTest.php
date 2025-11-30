<?php

declare(strict_types=1);

namespace Tests\Feature\Category;

use App\Models\Feed;
use App\Models\SubscriptionCategory;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DeleteCategoryTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_delete_empty_category(): void
    {
        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $this->actingAs($user);

        $response = $this->delete(route('category.delete', ['category_id' => $category->id]));

        $response->assertRedirect();

        $this->assertDatabaseMissing('subscription_categories', [
            'id' => $category->id,
        ]);
    }

    public function test_user_cannot_delete_category_with_subscriptions(): void
    {
        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $feed = Feed::factory()->create();
        $user->feeds()->attach($feed->id, ['category_id' => $category->id]);

        $this->actingAs($user);

        $response = $this->delete(route('category.delete', ['category_id' => $category->id]));

        $response->assertSessionHasErrors();

        $this->assertDatabaseHas('subscription_categories', [
            'id' => $category->id,
        ]);
    }

    public function test_user_cannot_delete_other_users_category(): void
    {
        $user1 = User::factory()->create();
        $user2 = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user1->id,
            'name' => 'Tech',
        ]);

        $this->actingAs($user2);

        $response = $this->delete(route('category.delete', ['category_id' => $category->id]));

        $response->assertSessionHasErrors();

        $this->assertDatabaseHas('subscription_categories', [
            'id' => $category->id,
        ]);
    }

    public function test_deleting_nonexistent_category_returns_error(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user);

        $response = $this->delete(route('category.delete', ['category_id' => 99999]));

        $response->assertSessionHasErrors();
    }

    public function test_unauthenticated_user_cannot_delete_category(): void
    {
        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $response = $this->delete(route('category.delete', ['category_id' => $category->id]));

        $response->assertRedirect(route('login'));
    }
}
