#!/bin/bash

php artisan optimize

php artisan migrate --force

# Remember to set a redis client timeout so that the container can go to sleep on Railway
# As with Octane, connections stay open for max-requests
# CONFIG SET timeout 10

php artisan octane:start --server=frankenphp \
    --host=0.0.0.0 \
    --port=8080 \
    --log-level=info \
    --caddyfile=./deploy/Caddyfile \
    --max-requests=1 \
    --workers=1
