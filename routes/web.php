<?php

declare(strict_types=1);

use App\Actions\Category\CreateCategory;
use App\Actions\Category\DeleteCategory;
use App\Actions\Entry\UpdateEntryInteractions;
use App\Actions\Feed\CreateNewFeed;
use App\Actions\Feed\MarkEntriesAsRead;
use App\Actions\Feed\RefreshFavicon;
use App\Actions\Feed\RefreshFeedEntries;
use App\Actions\Feed\UnsubscribeFromFeed;
use App\Actions\Feed\UpdateFeed;
use App\Actions\OPML\ExportOPML;
use App\Actions\OPML\ImportOPML;
use App\Actions\ShowCharts;
use App\Actions\ShowFeedReader;
use App\Actions\ShowSubscriptions;
use App\Actions\User\DeleteAccount;
use App\Actions\User\ShowSettings;
use App\Actions\User\UpdateProfile;
use App\Actions\User\WipeAccount;
use App\Features\Registration;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;
use Laravel\Pennant\Feature;

Route::get('/', function () {
    if (Auth::check()) {
        return redirect()->route('feeds.index');
    }

    return Inertia::render('Welcome', [
        'canRegister' => Feature::active(Registration::class),
    ]);
});

Route::middleware('auth')->group(function () {
    Route::get('/profile', ShowSettings::class)->name('profile.edit');
    Route::patch('/profile', UpdateProfile::class)->name('profile.update');
    Route::delete('/profile', DeleteAccount::class)->name('profile.destroy');

    Route::post('/profile/wipe', WipeAccount::class)->name('profile.wipe');

    // TODO: scoped route bindings
    Route::get('/feeds', ShowFeedReader::class)->name('feeds.index');

    Route::middleware(['throttle:create_feed'])->group(function () {
        Route::post('/feed', CreateNewFeed::class)->name('feed.store');
    });
    Route::delete('/feed/{feed_id}', UnsubscribeFromFeed::class)->name('feed.unsubscribe');
    Route::post('/feed/{feed_id}/refresh', RefreshFeedEntries::class)->name('feed.refresh');
    Route::post('/feed/{feed_id}/refresh-favicon', RefreshFavicon::class)->name('feed.refresh-favicon');
    Route::patch('feed/{feed_id}', UpdateFeed::class)->name('feed.update');
    Route::post('/feed/{feed_id}/mark-read', MarkEntriesAsRead::class)->name('feed.mark-read');

    Route::patch('/entry/{entry_id}', UpdateEntryInteractions::class)->name('entry.update');

    Route::post('category', CreateCategory::class)->name('category.store');
    Route::delete('category/{category_id}', DeleteCategory::class)->name('category.delete')->whereNumber('category_id');

    Route::get('/import', [ImportOPML::class, 'index'])->name('import.index');
    Route::post('/import', [ImportOPML::class, 'store'])->name('import.store');
    Route::get('/export', ExportOPML::class)->name('export.download');

    Route::get('/charts', ShowCharts::class)->name('charts.index');
    Route::get('/subscriptions', ShowSubscriptions::class)->name('subscriptions.index');
});

require __DIR__.'/auth.php';
