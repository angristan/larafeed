<?php

declare(strict_types=1);

namespace App\Actions\GoogleReaderAPI;

use Illuminate\Http\Request;
use Lorisleiva\Actions\Concerns\AsAction;

class GetToken
{
    use AsAction;

    public function asController(Request $request): \Illuminate\Http\Response
    {
        // Since the tokens don't expire, we can just return the token as is

        $authorization_header = $request->header('Authorization');
        $token = substr($authorization_header, strlen('GoogleLogin auth='));

        return response()->make(
            $token,
            200,
            ['Content-Type' => 'text/plain']
        );
    }
}
