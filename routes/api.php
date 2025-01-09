<?php

declare(strict_types=1);

use App\Actions\FeverAPI;
use App\Actions\GoogleReaderAPI;
use App\Http\Middleware\CheckFeverApiToken;
use App\Http\Middleware\CheckGoogleReaderToken;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');

// Google Reader API
Route::prefix('/reader')->group(function () {
    Route::post('accounts/ClientLogin', GoogleReaderAPI\ClientLogin::class);

    Route::prefix('/reader/api/0')
        ->middleware(CheckGoogleReaderToken::class)
        ->group(function () {
            Route::get('user-info', GoogleReaderAPI\GetUserInfo::class);
            Route::get('token', GoogleReaderAPI\GetToken::class);
            Route::get('subscription/list', GoogleReaderAPI\GetSubscriptionList::class);
            Route::get('stream/items/ids', GoogleReaderAPI\GetStreamItemIds::class);
            Route::post('stream/items/contents', GoogleReaderAPI\GetStreamContents::class);
            Route::post('edit-tag', GoogleReaderAPI\EditTag::class);
        });
});

// Fever API
Route::prefix('/fever')
    ->middleware(CheckFeverApiToken::class)
    ->group(function () {
        Route::match(['get', 'post'], '/', FeverAPI\HandleRequest::class);
    });
