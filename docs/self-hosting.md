# Self-hosting with Docker Compose

Self-hosting Larafeed is straightforward. The `docker-compose.yml` includes everything you need:
- **Web server** (FrankenPHP/Octane)
- **Queue worker** (background jobs)
- **Scheduler** (feed updates)
- **PostgreSQL** database
- **Redis** cache
- **imgproxy** (image optimization)

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/angristan/larafeed.git
cd larafeed

# 2. (Optional) Edit configuration
#    - Change APP_URL to your domain
#    - Add GEMINI_API_KEY for AI summaries
nano .env.compose

# 3. Start everything
docker compose up -d
```

That's it! Secrets (`APP_KEY`, `IMGPROXY_KEY`, `IMGPROXY_SALT`) are automatically generated on first run and stored in `.secrets/.env.generated`.

## Access

- **Web UI**: http://localhost:8000
- Create an account at the login page

## Configuration

Edit `.env.compose` before starting (or restart after changes):

| Variable | Description |
|----------|-------------|
| `APP_URL` | Your domain (e.g., `https://feeds.example.com`) |
| `GEMINI_API_KEY` | [Gemini API key](https://aistudio.google.com/apikey) for AI summaries |
| `TELEGRAM_BOT_TOKEN` | Optional: notifications on registration/failed logins |

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
