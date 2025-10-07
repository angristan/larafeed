<?php

declare(strict_types=1);

namespace App\Actions\User;

use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Redirect;
use Illuminate\Validation\Rule;
use Lorisleiva\Actions\Concerns\AsAction;

class UpdateSettings
{
    use AsAction;

    public function handle(Request $request): RedirectResponse
    {
        /** @var \App\Models\User $user */
        $user = $request->user();

        $validated = $request->validate([
            'pagination_mode' => [
                'required',
                Rule::in(User::PAGINATION_MODES),
            ],
        ]);

        $user->update([
            'pagination_mode' => $validated['pagination_mode'],
        ]);

        return Redirect::route('settings.edit');
    }
}
