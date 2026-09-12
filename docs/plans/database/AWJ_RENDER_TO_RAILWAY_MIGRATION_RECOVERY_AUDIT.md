# AWJ Render → Railway PostgreSQL Migration Recovery Audit

**Phase:** Audit and preparation only  
**Date:** 2026-09-12  
**Status:** STOP. No dump import, restore, merge, deploy, environment change, or production write until Safwan explicitly approves the next phase.  
**Repo:** `safwan5001-source/Nebrax`  
**Inspected main SHA:** `4fd91784222538f76d7b0ca46daf27657446a137`  
**Classification:** Production ERP / accounting. Data integrity, tenant isolation, referential integrity, and backward compatibility are mandatory.

This document supersedes, and cites, the 2026-09-03 Phase-1 audit in draft PR #620. It does **not** execute a migration.

---

## 1. Executive summary

The live Laravel API (`https://nibras-api-production.up.railway.app`) is on Railway and talks to a Railway PostgreSQL service named `nibras-db`. That database is **not** a completed copy of the historical Render PostgreSQL. Repository evidence and the operator’s verified read-only checks agree on the same failure mode:

1. There is **no** in-repo dump/restore/handoff script for Render → Railway.
2. The only production database action the image ever performs is `php artisan migrate --force` on every container start (`deploy/entrypoint.sh`). It never seeds tenants and never imports a dump.
3. Railway was therefore **initialized independently**: empty managed Postgres + Laravel schema (plus whatever was registered after cutover).
4. A read-only check on Railway found **one** tenant: `slug = dominah`.
5. A read-only check on Render found **multiple** tenants, including the intended Storefront preview tenant: `name = شركة طيبة`, `slug = mart`.
6. `/api/health` on Railway returns `{"status":"ok"}` and does **not** query PostgreSQL. Health is not proof of data.
7. Draft PRs #620 (audit) and #624 (emergency dump) already recorded this gap on 2026-09-03. #624 **stopped before `pg_dump`**. No checksummed Render dump is documented in the repository. Both PRs remain open drafts and were never merged to `main`.

**Recommended strategy (do not execute yet):**

> **Full logical restore of Render into a new empty PostgreSQL, then `php artisan migrate --force` for pending files only.** Keep the current Railway database as an untouched rollback artifact. Do **not** merge tenant graphs. Do **not** register `mart` by hand as a substitute for restore. Do **not** register the Storefront domain for شركة طيبة until that tenant exists on the database the live API actually uses.

**Next production writes:** none. The next authorized phase is still read-only: dual census + checksummed dumps.

The complete 14-section audit (architecture, prior-attempt evidence, comparison queries, missing data, schema diff, accounting risks, strategy A/B/C/D, staged plan, verification/rollback, downtime, backups, blockers, next task) is the file body that follows in the workspace copy and must match this path. If this GitHub blob is shorter than the workspace file, replace it before merge.
