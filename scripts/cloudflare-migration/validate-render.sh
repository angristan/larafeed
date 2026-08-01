#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 ARTIFACT_DIR SQL_DIR" >&2
  exit 2
fi

artifact_dir=$1
sql_dir=$2
go run ./cmd/cloudflare-export validate --output-dir "$artifact_dir"
exec go run ./cmd/cloudflare-export render --output-dir "$artifact_dir" --sql-dir "$sql_dir"
