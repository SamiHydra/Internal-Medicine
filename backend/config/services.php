<?php

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
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'sms' => [
        'driver' => env('SMS_DRIVER', 'log'),
        'from' => env('SMS_FROM'),
        'log_channel' => env('SMS_LOG_CHANNEL'),
        'http' => [
            'endpoint' => env('SMS_HTTP_ENDPOINT'),
            'token' => env('SMS_HTTP_TOKEN'),
            'to_field' => env('SMS_HTTP_TO_FIELD', 'to'),
            'message_field' => env('SMS_HTTP_MESSAGE_FIELD', 'message'),
            'from_field' => env('SMS_HTTP_FROM_FIELD', 'from'),
            'timeout' => (int) env('SMS_HTTP_TIMEOUT', 10),
        ],
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

];
