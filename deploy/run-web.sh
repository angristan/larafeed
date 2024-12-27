#!/bin/bash

# Run migrations, process the Nginx configuration template and start Nginx
php artisan migrate --force && node /assets/scripts/prestart.mjs /assets/nginx.template.conf /nginx.conf && (
    php-fpm -y /assets/php-fpm.conf &
    nginx -c /nginx.conf
)
