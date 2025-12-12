<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\PrecognitionControllerDispatcher;
use Illuminate\Foundation\Http\Middleware\HandlePrecognitiveRequests as BaseHandlePrecognitiveRequests;
use Illuminate\Routing\Contracts\ControllerDispatcher as ControllerDispatcherContract;

/**
 * Custom Precognition middleware that works with lorisleiva/laravel-actions.
 *
 * @see https://github.com/lorisleiva/laravel-actions/discussions/249
 */
class HandlePrecognitiveRequests extends BaseHandlePrecognitiveRequests
{
    /**
     * Prepare to handle a precognitive request.
     */
    protected function prepareForPrecognition($request): void
    {
        parent::prepareForPrecognition($request);

        // Override the dispatcher binding with our custom one that handles laravel-actions
        $this->container->bind(
            ControllerDispatcherContract::class,
            fn ($app) => new PrecognitionControllerDispatcher($app)
        );
    }
}
