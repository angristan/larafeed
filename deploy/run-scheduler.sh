#!/bin/bash

while true; do
    echo "Running the scheduler..."
    php artisan schedule:run --verbose --no-interaction &
    sleep 60
done
