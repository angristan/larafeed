<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class CheckFeverApiToken
{
    public function handle(Request $request, Closure $next)
    {
        $apiKey = $request->input('api_key');

        if (! $apiKey) {
            return response()->json([
                'api_version' => 3,
                'auth' => 0,
            ]);
        }

        $user = User::where('fever_api_key', $apiKey)->first();

        if (! $user) {
            return response()->json([
                'api_version' => 3,
                'auth' => 0,
            ]);
        }

        Auth::login($user);

        return $next($request);
    }
}
