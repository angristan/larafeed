<?php

declare(strict_types=1);

use App\Actions\GoogleReaderAPI\ClientLogin;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');

// Google Reader API
Route::prefix('/reader')->group(function () {
    Route::post('accounts/ClientLogin', ClientLogin::class);

});
