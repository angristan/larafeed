<?php

declare(strict_types=1);

namespace App\Actions\User;

use App\Models\User;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;
use Lorisleiva\Actions\Concerns\AsAction;

class ShowSettings
{
    use AsAction;

    public function handle(Request $request): Response
    {
        /** @var \App\Models\User $user */
        $user = $request->user();

        return Inertia::render('Settings/Index', [
            'paginationMode' => $user->pagination_mode ?? User::PAGINATION_MODE_INFINITE,
            'paginationModes' => User::PAGINATION_MODES,
            'showHnBadges' => (bool) ($user->show_hn_badges ?? true),
        ]);
    }
}
