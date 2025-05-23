<?php

declare(strict_types=1);

namespace App\Providers;

use App\Models\User;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Foundation\Application;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Vite;
use Illuminate\Support\ServiceProvider;
use Onliner\ImgProxy\UrlBuilder;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        Vite::prefetch(concurrency: 3);

        $this->app->bind(UrlBuilder::class, function (Application $app) {
            return UrlBuilder::signed(
                key: config('services.imgproxy.key'),
                salt: config('services.imgproxy.salt')
            );
        });

        Gate::define('viewPulse', function (User $user) {
            return in_array($user->email, [
                config('app.admin-email'),
            ]);
        });

        RateLimiter::for('create_feed', function (Request $request) {
            return Limit::perMinute(10)->by($request->user()?->id ?: $request->ip());
        });
    }
}
