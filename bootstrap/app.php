<?php

declare(strict_types=1);

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Sentry\Laravel\Integration;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        channels: __DIR__.'/../routes/channels.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        $middleware
            ->web(append: [
                \App\Http\Middleware\HandleInertiaRequests::class,
                \Illuminate\Http\Middleware\AddLinkHeadersForPreloadedAssets::class,
            ])
            ->trustProxies(at: [
                '100.64.0.0/10', // For Railway
            ])
            ->throttleWithRedis();
        // ->trustHosts(at: ['xzy.com']);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        Integration::handles($exceptions);
    })
    ->withCommands([
        \App\Actions\Feed\RefreshFeeds::class,
        \App\Actions\Feed\RefreshMissingFavicons::class,
    ])
    ->create();
