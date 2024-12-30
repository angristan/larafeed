<?php

declare(strict_types=1);

namespace App\Providers;

use Illuminate\Foundation\Application;
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
    }
}
