ARG GO_VERSION=1.26
ARG NODE_VERSION=24

# --- Build frontend assets ---
FROM node:${NODE_VERSION}-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY resources/ resources/
COPY vite.config.ts tsconfig.json postcss.config.js biome.json ./
RUN npm run build

# --- Build Go binary ---
FROM golang:${GO_VERSION}-alpine AS backend
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o larafeed ./main.go

# --- Final image ---
FROM alpine:3.21

RUN apk add --no-cache ca-certificates tzdata \
    && adduser -D -u 1000 larafeed

WORKDIR /app

COPY --from=backend /app/larafeed .
COPY --from=frontend /app/public/build public/build/
COPY public/favicon.ico public/logo.svg public/robots.txt public/rss.svg public/

USER larafeed

EXPOSE 3000

ENTRYPOINT ["./larafeed"]
