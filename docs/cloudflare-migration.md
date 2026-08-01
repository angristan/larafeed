# PostgreSQL to D1 migration

The migration tooling reads the legacy PostgreSQL database and creates deterministic, locally verifiable D1 import SQL. It never writes to PostgreSQL or Cloudflare.

## Safety model

- The exporter uses one PostgreSQL `REPEATABLE READ READ ONLY` transaction.
- Rows are read with keyset pagination in stable ID order.
- Passwords, remember tokens, TOTP secrets, sessions, and WebAuthn credentials are not exported.
- Every identifier must fit JavaScript's safe integer range.
- Timestamps become epoch milliseconds. JSON is canonicalized. Article HTML is separated into `entry_contents` and capped at 1,800,000 encoded bytes.
- Read history becomes one ingestion-ID watermark per subscription plus sparse exceptions.
- One source user must be selected explicitly as the target administrator.
- JSONL chunks have row limits, byte limits, SHA-256 hashes, and an artifact manifest.
- Rendering validates the complete artifact before writing idempotent SQL.
- The generated cleanup SQL is only for a fresh or disposable target. It deletes all application rows before import.

The artifact can contain article content and personal metadata. Store it with restricted permissions and delete it after the accepted cutover.

## Prerequisites

Use the exact PostgreSQL snapshot that will be migrated. The account only needs `CONNECT` and `SELECT` permissions. Run commands from the repository root with Go, Bun, and Wrangler dependencies installed.

Choose the source user that must remain an administrator:

```sql
SELECT id, name, email FROM users ORDER BY id;
```

## Measure without exporting rows

A dry run records source version, counts, and ID ranges. It does not create data chunks and does not require an administrator selection.

```bash
umask 077
DATABASE_URL='postgres://...' \
  scripts/cloudflare-migration/export.sh \
  ./artifacts/larafeed-metadata \
  --dry-run
```

Review `manifest.json` and the warnings. Also run the read-only baseline queries:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/postgres-baseline.sql
```

## Create and validate an artifact

The output directories must not exist or must be empty. Use the same source snapshot and administrator ID in every rehearsal.

```bash
umask 077
DATABASE_URL='postgres://...' \
  scripts/cloudflare-migration/export.sh \
  ./artifacts/larafeed-2025-01-01 \
  --admin-user-id 1 \
  --chunk-size 500

scripts/cloudflare-migration/validate-render.sh \
  ./artifacts/larafeed-2025-01-01 \
  ./artifacts/larafeed-2025-01-01-sql
```

Repeat the export against an unchanged snapshot and compare manifests and chunk hashes. The artifact is deterministic except for source metadata returned by PostgreSQL itself.

## Rehearse against local D1

Start with a new local D1 state. Apply migrations, then execute cleanup and rendered chunks in filename order.

```bash
npm run d1:migrate:local

for file in ./artifacts/larafeed-2025-01-01-sql/*.sql; do
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false \
    npx wrangler d1 execute DB --local \
    --env-file .dev.vars.example \
    --file "$file"
done

CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false \
  npx wrangler d1 execute DB --local \
  --env-file .dev.vars.example \
  --command 'PRAGMA foreign_key_check; PRAGMA quick_check;'
```

Compare target table counts with `manifest.json`. Test login enrollment for the selected administrator, reader totals, unread/read boundaries, stars, filters, categories, article content, and compatibility tokens.

## Production-shaped D1 validation

The Workerd benchmark generates deterministic fixtures and validates foreign keys, ownership, content caps, sparse interactions, read-watermark semantics, query results, query plans, and bounded D1 operation counts.

Use the small profile in normal CI:

```bash
bun scripts/cloudflare-validation/run.ts \
  --profile ci \
  --output-dir ./artifacts/d1-validation-ci
```

Use the large profile before cutover:

```bash
bun scripts/cloudflare-validation/run.ts \
  --profile large \
  --output-dir ./artifacts/d1-validation-large
```

The large profile contains 12,000 entries and about 115 MB of estimated data. Local elapsed time is diagnostic only. It is not evidence of production network latency or Cloudflare billing. Keep the JSON and Markdown reports with the rehearsal record.

## Cutover sequence

No command in this repository creates Cloudflare resources or deploys the application automatically.

1. Disable writes and background work in the legacy application.
2. Wait for active legacy refresh/import jobs to settle.
3. Run the final PostgreSQL baseline and full export.
4. Validate and render the artifact locally.
5. Apply D1 migrations to the empty production database.
6. Execute `0000-clean-target.sql`, then rendered chunks in filename order.
7. Run D1 foreign-key and integrity checks and compare counts.
8. Enroll a passkey for the selected administrator through an admin-generated access link or the documented operator recovery path.
9. Verify reader, refresh, OPML, compatibility, Images, and AI smoke tests.
10. Enable scheduler and dispatch controls, then open the new application.

This project accepts a maintenance window and does not define an automated rollback. Keep the legacy PostgreSQL database read-only until the cutover is accepted.
