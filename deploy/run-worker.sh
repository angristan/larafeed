#!/bin/bash

while true; do
    php artisan queue:work --max-jobs=100 --max-time=600 --memory=64
done
