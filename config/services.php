<?php

declare(strict_types=1);

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'token' => env('POSTMARK_TOKEN'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'resend' => [
        'key' => env('RESEND_KEY'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    'telegram-bot-api' => [
        'token' => env('TELEGRAM_BOT_TOKEN', 'YOUR BOT TOKEN HERE'),
        'chat_id' => env('TELEGRAM_CHAT_ID', 'YOUR CHAT ID HERE'),
    ],

    'imgproxy' => [
        'url' => env('IMGPROXY_URL'),
        'salt' => env('IMGPROXY_SALT'),
        'key' => env('IMGPROXY_KEY'),
    ],

    'datadog_rum' => [
        'application_id' => env('DD_RUM_APPLICATION_ID'),
        'client_token' => env('DD_RUM_CLIENT_TOKEN'),
        'site' => env('DD_RUM_SITE', 'datadoghq.eu'),
        'service' => env('DD_RUM_SERVICE', 'larafeed'),
        'env' => env('DD_RUM_ENV', 'production'),
        'session_sample_rate' => env('DD_RUM_SESSION_SAMPLE_RATE', 100),
        'session_replay_sample_rate' => env('DD_RUM_SESSION_REPLAY_SAMPLE_RATE', 100),
        'privacy_level' => env('DD_RUM_PRIVACY_LEVEL', 'mask-user-input'),
    ],
];
