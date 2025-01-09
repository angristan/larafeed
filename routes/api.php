<?php

declare(strict_types=1);

use App\Actions\FeverAPI\BaseFeverAction;
use App\Actions\FeverAPI\GetFeeds;
use App\Actions\FeverAPI\GetGroups;
use App\Actions\FeverAPI\GetItems;
use App\Actions\FeverAPI\GetSavedItemIds;
use App\Actions\FeverAPI\GetUnreadItemIds;
use App\Actions\FeverAPI\UpdateItem;
use App\Actions\GoogleReaderAPI\ClientLogin;
use App\Actions\GoogleReaderAPI\EditTag;
use App\Actions\GoogleReaderAPI\GetStreamContents;
use App\Actions\GoogleReaderAPI\GetStreamItemIds;
use App\Actions\GoogleReaderAPI\GetSubscriptionList;
use App\Actions\GoogleReaderAPI\GetToken;
use App\Actions\GoogleReaderAPI\GetUserInfo;
use App\Http\Middleware\CheckFeverApiToken;
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
            Route::get('subscription/list', GetSubscriptionList::class);
            Route::get('stream/items/ids', GetStreamItemIds::class);
            Route::post('stream/items/contents', GetStreamContents::class);
            Route::post('edit-tag', EditTag::class);
        });
});

// Fever API
Route::prefix('/fever')
    ->middleware(CheckFeverApiToken::class)
    ->group(function () {
        Route::match(['get', 'post'], '/', function (Request $request) {
            if ($request->has('groups')) {
                return app(GetGroups::class)->handle();
            }

            if ($request->has('feeds')) {
                return app(GetFeeds::class)->handle();
            }

            if ($request->has('items')) {
                return app(GetItems::class)->handle();
            }

            if ($request->has('unread_item_ids')) {
                return app(GetUnreadItemIds::class)->handle();
            }

            if ($request->has('saved_item_ids')) {
                return app(GetSavedItemIds::class)->handle();
            }

            if ($request->has('mark')) {
                return app(UpdateItem::class)->handle($request);
            }

            return response()->json((new BaseFeverAction)->getBaseResponse());
        });
    });
