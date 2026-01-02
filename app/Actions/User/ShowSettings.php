<?php

declare(strict_types=1);

namespace App\Actions\User;

use App\Models\User;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;
use Lorisleiva\Actions\Concerns\AsAction;

class ShowSettings
{
    use AsAction;

    public function asController(Request $request): Response
    {
        $section = (string) $request->query('section', 'profile');
        if (! in_array($section, ['profile', 'security', 'opml'], true)) {
            $section = 'profile';
        }

        /** @var User $user */
        $user = $request->user();

        return Inertia::render('Settings/Index', [
            'mustVerifyEmail' => $user instanceof MustVerifyEmail,
            'status' => session('status'),
            'initialSection' => $section,
            'twoFactorEnabled' => $user->two_factor_secret !== null,
            'twoFactorConfirmed' => $user->two_factor_confirmed_at !== null,
        ]);
    }
}
