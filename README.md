# Larafeed

<!-- badges -->

![](.github/readme/logo.png)

Larafeed is a simple feed reader.

## Features

- RSS, Atom and JSON feeds
- Background feed updates
- Full-text search
- Summary of entries powered by ChatGPT

## Technical overview

- Backend build with Laravel 9
  - Actions
- Vue.js 3 for the frontend
- Inertia.js
- Full text search with Laravel Scout, powered by Meilisearch
- Supports multiple database engines (thanks to Laravel)
- Background jobs are powered by the Laravel scheduler, Laravel queues and Laravel Horizon
  - The queue system is powered by Redis

## Run locally

Larafeed is built with Laravel Sail, so you can run it locally with Docker.

```bash
cp .env.example .env
./vendor/bin/sail up -d
./vendor/bin/sail artisan migrate --seed
./vendor/bin/sail npm install
./vendor/bin/sail npm run dev
```

## License

Larafeed is open-sourced software licensed under the [MIT license](LICENSE).
