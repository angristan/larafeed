.PHONY: install dev build preview test test-go lint typecheck types d1-migrate d1-validate deploy-check clean

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
	go test -race ./...

test-go:
	go test -race ./cmd/cloudflare-export

lint:
	npm run lint-check
	npm run typecheck
	golangci-lint run ./...

typecheck:
	npm run typecheck

types:
	npm run types:check:cloudflare

d1-migrate:
	npm run d1:migrate:local

d1-validate:
	npm run d1:validate

deploy-check:
	npm run deploy:check

clean:
	rm -rf dist .wrangler scripts/cloudflare-validation/output/report.json scripts/cloudflare-validation/output/report.md
