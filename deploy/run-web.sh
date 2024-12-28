#!/bin/bash

php artisan optimize

php artisan migrate --force

php artisan octane:start --server=frankenphp --host=0.0.0.0 --port=8080 --log-level=info --caddyfile=./deploy/Caddyfile
