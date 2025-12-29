<?php

declare(strict_types=1);

namespace Tests\Unit\Middleware;

use App\Http\Middleware\CheckGoogleReaderToken;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Tests\TestCase;

class CheckGoogleReaderTokenTest extends TestCase
{
    use RefreshDatabase;

    public function test_returns_error_when_no_authorization_header(): void
    {
        $request = Request::create('/api/greader', 'GET');

        $middleware = new CheckGoogleReaderToken;
        $response = $middleware->handle($request, fn () => response('OK'));

        $this->assertSame(401, $response->getStatusCode());
        $this->assertSame('Error=AuthRequired', $response->getContent());
        $this->assertSame('text/plain', $response->headers->get('Content-Type'));
    }

    public function test_returns_error_when_authorization_header_has_wrong_format(): void
    {
        $request = Request::create('/api/greader', 'GET');
        $request->headers->set('Authorization', 'Bearer some_token');

        $middleware = new CheckGoogleReaderToken;
        $response = $middleware->handle($request, fn () => response('OK'));

        $this->assertSame(401, $response->getStatusCode());
        $this->assertSame('Error=AuthRequired', $response->getContent());
    }

    public function test_returns_error_when_token_is_invalid(): void
    {
        $request = Request::create('/api/greader', 'GET');
        $request->headers->set('Authorization', 'GoogleLogin auth=invalid_token');

        $middleware = new CheckGoogleReaderToken;
        $response = $middleware->handle($request, fn () => response('OK'));

        $this->assertSame(403, $response->getStatusCode());
        $this->assertSame('Error=InvalidAuthToken', $response->getContent());
    }

    public function test_authenticates_user_with_valid_token(): void
    {
        $user = User::factory()->create();
        $token = $user->createToken('reader-api', ['reader-api']);

        $request = Request::create('/api/greader', 'GET');
        $request->headers->set('Authorization', 'GoogleLogin auth='.$token->plainTextToken);

        $nextCalled = false;
        $middleware = new CheckGoogleReaderToken;
        $response = $middleware->handle($request, function ($req) use (&$nextCalled, $user) {
            $nextCalled = true;
            $this->assertSame($user->id, $req->user()?->id);

            return response('OK');
        });

        $this->assertTrue($nextCalled);
        $this->assertSame($user->id, Auth::id());
    }

    public function test_returns_error_when_token_lacks_reader_api_ability(): void
    {
        $user = User::factory()->create();
        $token = $user->createToken('other-api', ['other-ability']);

        $request = Request::create('/api/greader', 'GET');
        $request->headers->set('Authorization', 'GoogleLogin auth='.$token->plainTextToken);

        $middleware = new CheckGoogleReaderToken;
        $response = $middleware->handle($request, fn () => response('OK'));

        $this->assertSame(403, $response->getStatusCode());
        $this->assertSame('Error=InvalidAuthToken', $response->getContent());
    }
}
