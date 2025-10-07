<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Http\Middleware\HandleInertiaRequests;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Tests\TestCase;

class SettingsTest extends TestCase
{
    use RefreshDatabase;

    public function test_settings_page_is_displayed(): void
    {
        $user = User::factory()->create();

        $response = $this
            ->actingAs($user)
            ->withHeaders($this->inertiaHeaders())
            ->get('/settings');

        $response->assertOk();
    }

    public function test_user_can_update_pagination_mode(): void
    {
        $user = User::factory()->create([
            'pagination_mode' => User::PAGINATION_MODE_INFINITE,
        ]);

        $response = $this
            ->actingAs($user)
            ->from('/settings')
            ->patch('/settings', [
                'pagination_mode' => User::PAGINATION_MODE_CLASSIC,
            ]);

        $response
            ->assertSessionHasNoErrors()
            ->assertRedirect('/settings');

        $this->assertSame(
            User::PAGINATION_MODE_CLASSIC,
            $user->refresh()->pagination_mode,
        );
    }

    public function test_reader_page_reflects_user_preference(): void
    {
        $user = User::factory()->create([
            'pagination_mode' => User::PAGINATION_MODE_CLASSIC,
        ]);

        $response = $this
            ->actingAs($user)
            ->withHeaders($this->inertiaHeaders())
            ->get('/feeds');

        $response->assertOk();
        $response->assertHeader('X-Inertia', 'true');
        $this->assertSame(
            User::PAGINATION_MODE_CLASSIC,
            $response->json('props.paginationMode'),
        );
    }

    /**
     * @return array<string, string>
     */
    private function inertiaHeaders(): array
    {
        $request = Request::create('/', 'GET');
        $version = app(HandleInertiaRequests::class)->version($request);

        return [
            'X-Inertia' => 'true',
            'X-Inertia-Version' => $version ?? '',
        ];
    }
}
