<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Laravel\Sanctum\PersonalAccessToken;

class CheckGoogleReaderToken
{
    public function handle(Request $request, Closure $next)
    {
        $authHeader = $request->header('Authorization');

        if (! $authHeader || ! str_starts_with($authHeader, 'GoogleLogin auth=')) {
            return response('Error=AuthRequired', 401)
                ->header('Content-Type', 'text/plain');
        }

        $authToken = substr($authHeader, strlen('GoogleLogin auth='));

        // Check token validity using Sanctum's PersonalAccessToken
        $token = PersonalAccessToken::findToken($authToken);

        if (! $token || ! $token->can('reader-api')) {
            return response('Error=InvalidAuthToken', 403)
                ->header('Content-Type', 'text/plain');
        }

        /** @var User $user */
        $user = $token->tokenable;

        // Set the authenticated user on the request
        $request->setUserResolver(function () use ($user) {
            return $user;
        });

        Auth::setUser($user);

        return $next($request);
    }
}
