<?php

declare(strict_types=1);

namespace Tests\Feature\Category;

use App\Actions\Category\CreateCategory;
use App\Models\SubscriptionCategory;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CreateCategoryTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_create_category(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user);

        $response = $this->post(route('category.store'), [
            'categoryName' => 'Tech',
        ]);

        $response->assertRedirect(route('feeds.index'));

        $this->assertDatabaseHas('subscription_categories', [
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);
    }

    public function test_category_name_is_required(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user);

        $response = $this->post(route('category.store'), [
            'categoryName' => '',
        ]);

        $response->assertSessionHasErrors('categoryName');
    }

    public function test_category_name_max_length_is_20(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user);

        $response = $this->post(route('category.store'), [
            'categoryName' => str_repeat('a', 21),
        ]);

        $response->assertSessionHasErrors('categoryName');
    }

    public function test_user_cannot_create_duplicate_category(): void
    {
        $user = User::factory()->create();

        SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $this->actingAs($user);

        $response = $this->post(route('category.store'), [
            'categoryName' => 'Tech',
        ]);

        $response->assertSessionHasErrors('categoryName');

        $this->assertCount(1, SubscriptionCategory::where('user_id', $user->id)->get());
    }

    public function test_different_users_can_have_same_category_name(): void
    {
        $user1 = User::factory()->create();
        $user2 = User::factory()->create();

        SubscriptionCategory::create([
            'user_id' => $user1->id,
            'name' => 'Tech',
        ]);

        $this->actingAs($user2);

        $response = $this->post(route('category.store'), [
            'categoryName' => 'Tech',
        ]);

        $response->assertRedirect(route('feeds.index'));

        $this->assertDatabaseHas('subscription_categories', [
            'user_id' => $user2->id,
            'name' => 'Tech',
        ]);
    }

    public function test_handle_method_creates_category(): void
    {
        $user = User::factory()->create();

        $category = CreateCategory::run($user, 'News');

        $this->assertInstanceOf(SubscriptionCategory::class, $category);
        $this->assertSame('News', $category->name);
        $this->assertSame($user->id, $category->user_id);
    }

    public function test_unauthenticated_user_cannot_create_category(): void
    {
        $response = $this->post(route('category.store'), [
            'categoryName' => 'Tech',
        ]);

        $response->assertRedirect(route('login'));
    }
}
