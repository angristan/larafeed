<?php

use App\Actions\Entry\SummarizeEntryWithChatGPT;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
|
| Here is where you can register API routes for your application. These
| routes are loaded by the RouteServiceProvider within a group which
| is assigned the "api" middleware group. Enjoy building your API!
|
*/

Route::middleware('auth:sanctum')->get('/user', function (Request $request) {
    return $request->user();
});

// TODO read about https://laravel.com/docs/9.x/sanctum#sanctum-middleware
Route::middleware(['auth:sanctum'])->group(function () {
    Route::get('/entry/{entry}/gpt-summary', SummarizeEntryWithChatGPT::class)->name('entry.gpt-summary');
});
