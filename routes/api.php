<?php

declare(strict_types=1);

use App\Actions\GoogleReaderAPI\ClientLogin;
use App\Actions\GoogleReaderAPI\GetToken;
use App\Actions\GoogleReaderAPI\GetUserInfo;
use App\Http\Middleware\CheckGoogleReaderToken;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');

// Google Reader API
Route::prefix('/reader')->group(function () {
    Route::post('accounts/ClientLogin', ClientLogin::class);

    Route::prefix('/reader/api/0')
        ->middleware(CheckGoogleReaderToken::class)
        ->group(function () {
            Route::get('user-info', GetUserInfo::class);
            Route::get('token', GetToken::class);
        });
});
