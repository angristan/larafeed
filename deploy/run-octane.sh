#!/bin/bash

php artisan optimize:clear

php artisan config:cache
php artisan event:cache
php artisan route:cache
php artisan view:cache

php artisan migrate --force

php artisan octane:start --server=frankenphp --host=0.0.0.0 --port=8000 --caddyfile=./Caddyfile
