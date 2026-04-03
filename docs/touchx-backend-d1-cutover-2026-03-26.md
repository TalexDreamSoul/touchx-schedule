# TouchX Backend D1 Cutover Snapshot (2026-03-26)

## Cutover Baseline

- Service: `touchx-backend`
- Domain: `schedule-backend.tagzxia.com`
- Cutover date: `2026-03-26`

## D1 Mapping

- Old DB
  - `database_name`: `tuff-nexus-prod`
  - `database_id`: `ebdeb7fc-74a4-4963-9bca-310a9aa0e4d6`
- New DB
  - `database_name`: `touchx-nexus-prod`
  - `database_id`: `5ceddf38-fbb8-4750-bea7-7314d2bcedfa`

## Password Reset Strategy

- `NEXUS_ADMIN_LOGIN_PASSWORD` is intentionally set to empty, so `/nexus/init` can be used for re-initialization.
- `NEXUS_ADMIN_BOOTSTRAP_STUDENT_NO` should stay `2305100613`.

## Rollback Commands

1. Restore D1 binding in `apps/backend/wrangler.toml`:
   - `database_name = "tuff-nexus-prod"`
   - `database_id = "ebdeb7fc-74a4-4963-9bca-310a9aa0e4d6"`

2. Optional password behavior rollback (choose one):
   - Keep init mode:
     - `printf "" | pnpm --filter @touchx/backend exec wrangler secret put NEXUS_ADMIN_LOGIN_PASSWORD`
   - Restore fixed password mode:
     - `pnpm --filter @touchx/backend exec wrangler secret put NEXUS_ADMIN_LOGIN_PASSWORD`

3. Redeploy:
   - `pnpm --filter @touchx/backend run deploy`

4. Verify:
   - `curl "https://schedule-backend.tagzxia.com/health"`
   - `curl "https://schedule-backend.tagzxia.com/api/v1/admin/bootstrap-status"`
