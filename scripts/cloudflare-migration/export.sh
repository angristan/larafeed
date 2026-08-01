#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: DATABASE_URL=... $0 ARTIFACT_DIR --admin-user-id ID [--chunk-size N|--dry-run]" >&2
  exit 2
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 2
fi

artifact_dir=$1
shift
exec go run ./cmd/cloudflare-export export --output-dir "$artifact_dir" "$@"
