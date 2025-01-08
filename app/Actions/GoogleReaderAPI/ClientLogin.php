<?php

declare(strict_types=1);

namespace App\Actions\GoogleReaderAPI;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Lorisleiva\Actions\Concerns\AsAction;

class ClientLogin
{
    use AsAction;

    public function rules(): array
    {
        return [
            'Email' => 'required|email',
            'Passwd' => 'required',
        ];
    }

    public function asController(Request $request)
    {
        $user = User::where('email', $request->input('Email'))->first();
        if (! $user || ! Hash::check($request->input('Passwd'), $user->password)) {
            return response('Error=BadAuthentication', 403)
                ->header('Content-Type', 'text/plain');
        }

        $authToken = Str::random(64);

        // Create sanctum token
        $user->tokens()->create([
            'name' => 'reader-auth-token',
            'token' => hash('sha256', $authToken),
            'abilities' => ['reader-api'],
        ]);

        return response()->json([
            'Auth' => $authToken,
            'SID' => $authToken,
            'LSID' => $authToken,
        ]);
    }
}
