.PHONY: install dev build preview test lint typecheck types d1-migrate d1-migrate-test d1-validate deploy-check deploy-test validate clean

install:
	npm ci

dev:
	npm run dev

build:
	npm run build

preview:
	npm run preview

test:
	npm test

lint:
	npm run lint-check
	npm run typecheck

typecheck:
	npm run typecheck

types:
	npm run types:check:cloudflare

d1-migrate:
	npm run d1:migrate:local

d1-migrate-test:
	npm run d1:migrate:test

d1-validate:
	npm run d1:validate

deploy-check:
	npm run deploy:check

deploy-test:
	npm run deploy:test

validate:
	npm run validate

clean:
	rm -rf dist .wrangler scripts/cloudflare-validation/output/report.json scripts/cloudflare-validation/output/report.md
