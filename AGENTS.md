# Larafeed - Go Backend + React Frontend

## Architecture
- Go backend using Chi v5 router, gonertia v2 for Inertia SSR, pgx v5 for PostgreSQL
- React frontend with Inertia.js v2, TypeScript, Vite
- sqlc for type-safe SQL queries, Goose for migrations
- River for background job queue (PostgreSQL-backed)

## Project Structure
- `internal/` — Go backend code (handlers, services, db, auth, worker, server)
- `resources/js/` — React frontend (Pages, Components, Layouts)
- `main.go` — Application entry point
- `sqlc.yaml` — sqlc configuration for query generation

## Development
- `make dev` or `docker compose -f docker-compose.dev.yml up` for local development
- `npm run dev` for Vite dev server with HMR
- `go test ./...` for Go tests
- `npm run lint-check` and `npm run typecheck` for frontend checks

## Conventions
- Follow existing code conventions. Check sibling files for structure and naming.
- Use subagents when possible to save context, especially for exploration.
- Check the README and update it if necessary when making changes.
- Use descriptive variable and function names.
- Check for existing components to reuse before writing new ones.

## Testing
- Write tests for changes. Run affected tests to verify.
- Unit tests: `go test -short ./...` (no DB needed)
- Integration tests: `make test` (requires test DB)

## Frontend
- Inertia.js v2 React pages live in `resources/js/Pages/`
- When using deferred props, add skeleton loading states.
- If frontend changes aren't reflected, run `npm run build` or `npm run dev`.
