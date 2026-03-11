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

Secrets (`SESSION_SECRET`, `IMGPROXY_KEY`, `IMGPROXY_SALT`) are automatically generated on first run.

## What's Included

- **Go application** (web server + background worker, single binary)
- **PostgreSQL** database
- **imgproxy** (image/favicon optimization)

## Configuration

Edit `.env` before starting:

| Variable             | Description                                                           | Required |
| -------------------- | --------------------------------------------------------------------- | -------- |
| `DATABASE_URL`       | PostgreSQL connection string                                          | Yes      |
| `SESSION_SECRET`     | 32-byte secret for session encryption                                 | Yes      |
| `APP_URL`            | Your domain (e.g., `https://feeds.example.com`)                       | Yes      |
| `PORT`               | HTTP port (default: `3000`)                                           | No       |
| `REGISTRATION_ENABLED` | Allow new registrations (default: `true`)                          | No       |
| `IMGPROXY_URL`       | imgproxy instance URL                                                 | No       |
| `IMGPROXY_KEY`       | imgproxy signing key                                                  | No       |
| `IMGPROXY_SALT`      | imgproxy signing salt                                                 | No       |
| `GEMINI_API_KEY`     | [Gemini API key](https://aistudio.google.com/apikey) for AI summaries | No       |
| `TELEGRAM_BOT_TOKEN` | Notifications on registration/failed logins                           | No       |
| `TELEGRAM_CHAT_ID`   | Telegram chat ID for notifications                                    | No       |
| `SMTP_HOST`          | SMTP server for emails                                                | No       |
| `SMTP_PORT`          | SMTP port (default: `587`)                                            | No       |
| `SMTP_USER`          | SMTP username                                                         | No       |
| `SMTP_PASS`          | SMTP password                                                         | No       |
| `MAIL_FROM`          | From address for emails                                               | No       |

## Reverse Proxy (Production)

For production, put a reverse proxy (nginx, Caddy, Traefik) in front and configure TLS.

## Useful Commands

```bash
# View logs
docker compose logs -f app

# Stop everything
docker compose down

# Update to latest version
docker compose pull && docker compose up -d

# Reset secrets (regenerate on next start)
rm -rf .secrets && docker compose up -d
```
