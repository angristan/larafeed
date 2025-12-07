<?php

declare(strict_types=1);

namespace App\Actions\Auth;

use App\Models\User;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;
use Lorisleiva\Actions\Concerns\AsAction;

class ResetPassword
{
    use AsAction;

    /**
     * @return array<int, string>
     */
    public static function getControllerMiddleware(): array
    {
        return ['guest'];
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        if (request()->isMethod('GET')) {
            return [];
        }

        return [
            'token' => 'required',
            'email' => 'required|email',
            'password' => ['required', 'confirmed', Rules\Password::defaults()],
        ];
    }

    public function handle(string $email, string $password, string $passwordConfirmation, string $token): string
    {
        return Password::reset(
            [
                'email' => $email,
                'password' => $password,
                'password_confirmation' => $passwordConfirmation,
                'token' => $token,
            ],
            function (User $user) use ($email, $password) {
                $user->forceFill([
                    'password' => Hash::make($password),
                    'remember_token' => Str::random(60),
                    'fever_api_key' => md5($email.':'.$password),
                ])->save();

                event(new PasswordReset($user));
            }
        );
    }

    public function asController(Request $request): Response|RedirectResponse
    {
        if ($request->isMethod('GET')) {
            return Inertia::render('Auth/ResetPassword', [
                'email' => $request->email,
                'token' => $request->route('token'),
            ]);
        }

        $status = $this->handle(
            $request->input('email'),
            $request->input('password'),
            $request->input('password_confirmation'),
            $request->input('token')
        );

        if ($status === Password::PASSWORD_RESET) {
            return redirect()->route('login')->with('status', __($status));
        }

        throw ValidationException::withMessages([
            'email' => [trans($status)],
        ]);
    }
}
