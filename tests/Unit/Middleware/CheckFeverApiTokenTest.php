<?php

declare(strict_types=1);

namespace Tests\Unit\Middleware;

use App\Http\Middleware\CheckFeverApiToken;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Tests\TestCase;

class CheckFeverApiTokenTest extends TestCase
{
    use RefreshDatabase;

    public function test_returns_auth_failure_when_no_api_key_provided(): void
    {
        $request = Request::create('/api/fever', 'POST');

        $middleware = new CheckFeverApiToken;
        $response = $middleware->handle($request, fn () => response()->json(['success' => true]));

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame([
            'api_version' => 3,
            'auth' => 0,
        ], json_decode($response->getContent(), true));
    }

    public function test_returns_auth_failure_when_invalid_api_key_provided(): void
    {
        $request = Request::create('/api/fever', 'POST', [
            'api_key' => 'invalid_api_key',
        ]);

        $middleware = new CheckFeverApiToken;
        $response = $middleware->handle($request, fn () => response()->json(['success' => true]));

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame([
            'api_version' => 3,
            'auth' => 0,
        ], json_decode($response->getContent(), true));
    }

    public function test_authenticates_user_with_valid_api_key(): void
    {
        $user = User::factory()->create([
            'fever_api_key' => 'valid_api_key_123',
        ]);

        $request = Request::create('/api/fever', 'POST', [
            'api_key' => 'valid_api_key_123',
        ]);

        $nextCalled = false;
        $middleware = new CheckFeverApiToken;
        $response = $middleware->handle($request, function () use (&$nextCalled) {
            $nextCalled = true;

            return response()->json(['success' => true]);
        });

        $this->assertTrue($nextCalled);
        $this->assertSame($user->id, Auth::id());
        $this->assertSame(200, $response->getStatusCode());
    }

    public function test_returns_auth_failure_when_user_not_found(): void
    {
        $request = Request::create('/api/fever', 'POST', [
            'api_key' => 'non_existent_key',
        ]);

        $middleware = new CheckFeverApiToken;
        $response = $middleware->handle($request, fn () => response()->json(['success' => true]));

        $this->assertSame([
            'api_version' => 3,
            'auth' => 0,
        ], json_decode($response->getContent(), true));
        $this->assertNull(Auth::user());
    }
}
