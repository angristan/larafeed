.PHONY: build run dev clean test lint generate-mocks

build:
	go build -o larafeed ./main.go

run: build
	./larafeed

dev:
	docker compose -f docker-compose.dev.yml up --build

test:
	go test ./... -race

test-unit:
	go test -short ./... -race

lint:
	golangci-lint run ./...

generate-mocks:
	go generate ./internal/db/...

clean:
	rm -rf larafeed tmp
