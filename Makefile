.PHONY: build run dev clean test

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

clean:
	rm -rf larafeed tmp
