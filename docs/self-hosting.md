# Self-hosting with Docker Compose

## Quick Start

```bash
git clone https://github.com/angristan/larafeed.git
cd larafeed/deploy

# (Optional) Edit configuration
cp .env.compose .env.compose.local
nano .env.compose.local

docker compose up -d
```

Access at <http://localhost:8000> and create an account.

Secrets (`APP_KEY`, `IMGPROXY_KEY`, `IMGPROXY_SALT`) are automatically generated on first run.

## What's Included

- **Web server** (FrankenPHP/Octane)
- **Queue worker** (background jobs)
- **Scheduler** (feed updates)
- **PostgreSQL** database
- **Redis** cache
- **imgproxy** (image optimization)

## Configuration

Edit `.env.compose` (or `.env.compose.local`) before starting:

| Variable             | Description                                                           |
| -------------------- | --------------------------------------------------------------------- |
| `APP_URL`            | Your domain (e.g., `https://feeds.example.com`)                       |
| `GEMINI_API_KEY`     | [Gemini API key](https://aistudio.google.com/apikey) for AI summaries |
| `TELEGRAM_BOT_TOKEN` | Optional: notifications on registration/failed logins                 |

## Performance Tuning

By default, the web server runs with **Laravel Octane**, which keeps your application in memory between requests for better performance. This is recommended for most deployments.

For **low-memory environments** (e.g., small VPS, Raspberry Pi), you can disable Octane by changing the web service command:

```yaml
# Replace the octane command with classic FrankenPHP mode:
command:
    [
        "sh",
        "-c",
        "if [ -f /secrets/.env.generated ]; then export $$(cat /secrets/.env.generated | xargs); fi && php artisan optimize && php artisan migrate --force && frankenphp run --config ./deploy/Caddyfile.classic",
    ]
```

| Mode             | Memory | Performance | Use Case               |
| ---------------- | ------ | ----------- | ---------------------- |
| Octane (default) | Higher | Fast        | Production, most users |
| Classic          | Lower  | Standard    | Low-memory VPS, RPi    |

## Reverse Proxy (Production)

For production, put a reverse proxy (nginx, Caddy, Traefik) in front.

## Useful Commands

```bash
# View logs
docker compose logs -f web

# Stop everything
docker compose down

# Update to latest version
docker compose pull && docker compose up -d

# Reset secrets (regenerate on next start)
rm -rf .secrets && docker compose up -d
```
