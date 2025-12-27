<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Illuminate\Http\Request;
use Inertia\Middleware;

class HandleInertiaRequests extends Middleware
{
    /**
     * The root template that is loaded on the first page visit.
     *
     * @var string
     */
    protected $rootView = 'app';

    /**
     * Determine the current asset version.
     */
    public function version(Request $request): ?string
    {
        return parent::version($request);
    }

    /**
     * Define the props that are shared by default.
     *
     * @return array<string, mixed>
     */
    public function share(Request $request): array
    {
        return [
            ...parent::share($request),
            'auth' => [
                'user' => $request->user(),
            ],
            'datadogRum' => [
                'applicationId' => config('services.datadog_rum.application_id'),
                'clientToken' => config('services.datadog_rum.client_token'),
                'site' => config('services.datadog_rum.site'),
                'service' => config('services.datadog_rum.service'),
                'env' => config('services.datadog_rum.env'),
                'sessionSampleRate' => (int) config('services.datadog_rum.session_sample_rate'),
                'sessionReplaySampleRate' => (int) config('services.datadog_rum.session_replay_sample_rate'),
                'privacyLevel' => config('services.datadog_rum.privacy_level'),
            ],
        ];
    }
}
