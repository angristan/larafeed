.PHONY: install dev build preview test lint typecheck types d1-migrate d1-migrate-test d1-validate deploy-check deploy-test validate clean

install:
	bun install --frozen-lockfile

dev:
	bun run dev

build:
	bun run build

preview:
	bun run preview

test:
	bun run test

lint:
	bun run lint-check
	bun run typecheck

typecheck:
	bun run typecheck

types:
	bun run types:check:cloudflare

d1-migrate:
	bun run d1:migrate:local

d1-validate:
	bun run d1:validate

deploy-check:
	bun run deploy:check

validate:
	bun run validate

clean:
	rm -rf dist .wrangler scripts/cloudflare-validation/output/report.json scripts/cloudflare-validation/output/report.md
