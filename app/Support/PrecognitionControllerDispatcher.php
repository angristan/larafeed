<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Container\Container;
use Illuminate\Foundation\Routing\PrecognitionControllerDispatcher as BasePrecognitionControllerDispatcher;
use Illuminate\Routing\Route;
use Lorisleiva\Actions\Decorators\ControllerDecorator;

/**
 * Custom Precognition dispatcher that works with lorisleiva/laravel-actions.
 *
 * The issue is that laravel-actions wraps action classes in a ControllerDecorator,
 * which causes Precognition to fail because it can't find the method on the decorator.
 * This dispatcher extracts the actual action class from the route definition.
 *
 * @see https://github.com/lorisleiva/laravel-actions/discussions/249
 */
class PrecognitionControllerDispatcher extends BasePrecognitionControllerDispatcher
{
    public function __construct(Container $container)
    {
        parent::__construct($container);
    }

    /**
     * Dispatch a request to a given controller and method.
     *
     * @param  mixed  $controller
     * @param  string  $method
     */
    public function dispatch(Route $route, $controller, $method): void
    {
        // If the controller is a ControllerDecorator from laravel-actions,
        // extract the actual action class from the route definition
        if ($controller instanceof ControllerDecorator) {
            $controllerClass = $route->action['controller'] ?? null;

            if (is_string($controllerClass)) {
                // Parse "App\Actions\User\UpdateProfile@asController" format
                if (str_contains($controllerClass, '@')) {
                    [$controllerClass] = explode('@', $controllerClass);
                }

                // Create an instance of the action class for method checking
                $actionInstance = $this->container->make($controllerClass);

                $this->ensureMethodExists($actionInstance, $method);
                $this->resolveParameters($route, $actionInstance, $method);

                abort(204, headers: ['Precognition-Success' => 'true']);
            }
        }

        // Fall back to parent implementation for non-action controllers
        parent::dispatch($route, $controller, $method);
    }
}
