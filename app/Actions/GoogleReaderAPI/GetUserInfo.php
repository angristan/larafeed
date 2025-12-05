<?php

declare(strict_types=1);

namespace App\Actions\GoogleReaderAPI;

use Illuminate\Support\Facades\Auth;
use Lorisleiva\Actions\Concerns\AsAction;

class GetUserInfo
{
    use AsAction;

    public function asController(): \Illuminate\Http\JsonResponse
    {
        /** @var \App\Models\User $user */
        $user = Auth::user();

        return response()->json([
            'userId' => (string) $user->id,
            'userName' => $user->name,
            'userEmail' => $user->email,
            'userProfileId' => (string) $user->id,
        ]);
    }
}
