<?php

declare(strict_types=1);

namespace App\Actions\User;

use App\Http\Requests\ProfileUpdateRequest;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Redirect;
use Lorisleiva\Actions\Concerns\AsAction;

class UpdateProfile
{
    use AsAction;

    /**
     * @param array<string, mixed> $attributes
     */
    public function handle(User $user, array $attributes): void
    {
        $user->fill($attributes);

        if ($user->isDirty('email')) {
            $user->email_verified_at = null;
        }

        $user->save();
    }

    public function asController(ProfileUpdateRequest $request): RedirectResponse
    {
        /** @var User $user */
        $user = Auth::user();

        $this->handle($user, $request->validated());

        return Redirect::route('profile.edit');
    }
}
