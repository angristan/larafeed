<?php

use App\Http\Controllers\FeedController;
use App\Http\Controllers\ProfileController;
use Illuminate\Foundation\Application;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

/*
|--------------------------------------------------------------------------
| Web Routes
|--------------------------------------------------------------------------
|
| Here is where you can register web routes for your application. These
| routes are loaded by the RouteServiceProvider within a group which
| contains the "web" middleware group. Now create something great!
|
*/

Route::get('/', function () {
    return Inertia::render('Welcome', [
        'canLogin' => Route::has('login'),
        'canRegister' => Route::has('register'),
        'laravelVersion' => Application::VERSION,
        'phpVersion' => PHP_VERSION,
    ]);
});

Route::get('/dashboard', function () {
    return Inertia::render('Dashboard');
})->middleware(['auth', 'verified'])->name('dashboard');

// Route::resource('feed', FeedController::class)->middleware('auth')->only(['index', 'store', 'destroy']);

Route::middleware('auth')->group(function () {
    Route::get('/profile', [ProfileController::class, 'edit'])->name('profile.edit');
    Route::patch('/profile', [ProfileController::class, 'update'])->name('profile.update');
    Route::delete('/profile', [ProfileController::class, 'destroy'])->name('profile.destroy');

    // TODO: scoped route bindings
    Route::get('/feeds', [FeedController::class, 'index'])->name('feeds.index');
    Route::get('/feed/{feed}/entries', [FeedController::class, 'show'])->name('feed.entries')->whereNumber('feed');
    Route::get('/feed/{feed}/entry/{entry}', [FeedController::class, 'showEntry'])->name('feed.entry')->whereNumber('feed')->whereNumber('entry');
    Route::post('/feed/{feed}/refresh', [FeedController::class, 'refresh'])->name('feed.refresh')->whereNumber('feed');
});

require __DIR__.'/auth.php';
