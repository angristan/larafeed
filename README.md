# Larafeed

<!-- badges -->

![](.github/readme/logo.png)

Larafeed is a simple feed reader.

## Features

- RSS and Atom feed support
- Background feed updates
- Full-text search through a reactive search bar
- AI-generated summary of entries
- Favicon display
- GitHub-like sparkline graphs representing feed acitivity

## Technical overview

- Backend build with Laravel 11
  - Architectured around [Actions](https://laravelactions.com/)
- Vue.js 3 for the frontend
- [Inertia.js](https://inertiajs.com/) that does the magic glue between Laravel and Vue.js
- Feed parsing is powered by [SimplePie](https://github.com/simplepie/simplepie)
  - Through [willvincent/feeds](https://github.com/willvincent/feeds)
- Full text search with Laravel Scout
- Summary generation is powered by [ChatGPT](https://openai.com/blog/chatgpt/)
  - Through [openai-php/laravel](https://github.com/openai-php/laravel)
  - The prompt is truncated using the GPT3 tokenizer, implemeted in PHP in [Gioni06/GPT3Tokenizer](https://github.com/Gioni06/GPT3Tokenizer)
- Background jobs are powered by the Laravel scheduler, Laravel queues and Laravel Horizon
- Favicon fetching is powered by [ash-jc-allen/favicon-fetcher](https://github.com/ash-jc-allen/favicon-fetcher)
- Sparkline graphs are powered by [brendt/php-sparkline](https://github.com/brendt/php-sparkline)
- The frontend uses [Tailwind CSS](https://tailwindcss.com/) with some plugins
  - [Tailwind CSS Typography](https://tailwindcss.com/docs/typography-plugin) to render entry content
  - [daisyUI](https://daisyui.com/) to write less classes
  - [Flowbite](https://flowbite.com/), for some components
- [Element Plus](https://element-plus.org/en-US/) is available as a component library, it's only used for toasts right now lol

## Screenshots

### Feed list

![](.github/readme/feeds.png)

### Feed

![](.github/readme/feed.png)

### Entry

![](.github/readme/entry.png)

## Run locally

Larafeed is built with Laravel Sail, so you can run it locally with Docker.

```bash
cp .env.example .env # and adjust the values
composer update
php artisan migrate --seed
npm install
composer dev
```

A [quick login link](https://github.com/spatie/laravel-login-link) is available on the login form, which will create a user and log you in.

## License

Larafeed is licensed under the [MIT license](LICENSE).
