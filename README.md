# Larafeed

<!-- badges -->

![](.github/readme/logo.png)

Larafeed is a simple feed reader.

## Features

- RSS and Atom feed support
- Background feed updates
- Full-text search
- Summary of entries powered by ChatGPT

## Technical overview

- Backend build with Laravel 9
  - Architectured around [Actions](https://laravelactions.com/)
- Vue.js 3 for the frontend
- Inertia.js that does the magic glue between Laravel and Vue.js
- Feed parsing is powered by [SimplePie](https://github.com/simplepie/simplepie)
- Full text search with Laravel Scout, powered by [Meilisearch](https://github.com/meilisearch/meilisearch)
- Supports multiple database engines (thanks to Laravel)
- Background jobs are powered by the Laravel scheduler, Laravel queues and Laravel Horizon
  - The queue system is powered by Redis

## Run locally

Larafeed is built with Laravel Sail, so you can run it locally with Docker.

```bash
cp .env.example .env # and adjust the values
./vendor/bin/sail up -d
./vendor/bin/sail artisan migrate --seed
./vendor/bin/sail npm install
./vendor/bin/sail npm run dev
```

## License

Larafeed is licensed under the [MIT license](LICENSE).
