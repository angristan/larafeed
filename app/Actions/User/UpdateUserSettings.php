<?php

declare(strict_types=1);

namespace App\Actions\User;

use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Redirect;
use Inertia\Inertia;
use Lorisleiva\Actions\Concerns\AsAction;

class UpdateUserSettings
{
    use AsAction;

    public function index(Request $request): \Inertia\Response
    {
        return Inertia::render('Settings', [
            'paginationType' => $request->user()->pagination_type,
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'pagination_type' => 'required|in:infinite,classic',
        ]);

        $user = Auth::user();
        $user->pagination_type = $validated['pagination_type'];
        $user->save();

        return Redirect::route('settings.index')->with('success', 'Settings updated successfully');
    }
}
