.PHONY: build run dev clean test

build:
	go build -o larafeed ./main.go

run: build
	./larafeed

dev:
	docker compose -f docker-compose.dev.yml up --build

test:
	TEST_DATABASE_URL="postgres://larafeed:larafeed@127.0.0.1:5432/larafeed_test?sslmode=disable" go test ./... -race

test-unit:
	go test -short ./... -race

test-create-db:
	docker compose -f docker-compose.dev.yml exec -T postgres psql -U larafeed -c "CREATE DATABASE larafeed_test" 2>/dev/null || true

clean:
	rm -rf larafeed tmp
