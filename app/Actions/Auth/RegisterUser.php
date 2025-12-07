<?php

declare(strict_types=1);

namespace App\Actions\Auth;

use App\Features\Registration;
use App\Models\User;
use Illuminate\Auth\Events\Registered;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules;
use Inertia\Inertia;
use Inertia\Response;
use Laravel\Pennant\Middleware\EnsureFeaturesAreActive;
use Lorisleiva\Actions\Concerns\AsAction;

class RegisterUser
{
    use AsAction;

    /**
     * @return array<int, mixed>
     */
    public static function getControllerMiddleware(): array
    {
        return ['guest', EnsureFeaturesAreActive::using(Registration::class)];
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
            'name' => 'required|string|max:255',
            'email' => 'required|string|lowercase|email|max:255|unique:'.User::class,
            'password' => ['required', 'confirmed', Rules\Password::defaults()],
        ];
    }

    public function handle(string $name, string $email, string $password): User
    {
        $user = User::create([
            'name' => $name,
            'email' => $email,
            'password' => Hash::make($password),
            'fever_api_key' => md5($email.':'.$password),
        ]);

        event(new Registered($user));

        return $user;
    }

    public function asController(Request $request): Response|RedirectResponse
    {
        if ($request->isMethod('GET')) {
            return Inertia::render('Auth/Register');
        }

        $user = $this->handle(
            $request->input('name'),
            $request->input('email'),
            $request->input('password')
        );

        Auth::login($user);

        return redirect(route('feeds.index', absolute: false));
    }
}
