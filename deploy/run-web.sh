#!/bin/bash

php artisan optimize

php artisan migrate --force

frankenphp run --config /etc/caddy/Caddyfile --adapter caddyfile
