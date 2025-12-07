<?php

declare(strict_types=1);

namespace App\Actions\Auth;

use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;
use Lorisleiva\Actions\Concerns\AsAction;

class UpdatePassword
{
    use AsAction;

    /**
     * @return array<int, string>
     */
    public static function getControllerMiddleware(): array
    {
        return ['auth'];
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'current_password' => ['required', 'current_password'],
            'password' => ['required', Password::defaults(), 'confirmed'],
        ];
    }

    public function handle(User $user, string $password): void
    {
        $user->update([
            'password' => Hash::make($password),
        ]);
    }

    public function asController(Request $request): RedirectResponse
    {
        /** @var User $user */
        $user = Auth::user();

        $this->handle($user, $request->input('password'));

        return back();
    }
}
