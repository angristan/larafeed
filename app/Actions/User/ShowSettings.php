<?php

declare(strict_types=1);

namespace App\Actions\User;

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
        if (! in_array($section, ['profile', 'opml'], true)) {
            $section = 'profile';
        }

        $user = $request->user();

        return Inertia::render('Settings/Index', [
            'mustVerifyEmail' => $user instanceof MustVerifyEmail,
            'status' => session('status'),
            'initialSection' => $section,
        ]);
    }
}
