# AWJ Render PostgreSQL Emergency Backup Report

**Phase:** Backup + verification only  
**Date (UTC):** 2026-09-03  
**Agent run:** `bc-1f064e1e-e753-499b-aa99-692fdafff355`  
**Status:** **STOPPED BEFORE DUMP.** Source was not opened. No backup file was created.

This document records a **failed prerequisite check**, not a completed backup. Treat the historical Render database as still **unexported from this session**.

---

## 1. Scope and safety statement

Scope of this run was **read-only source verification + `pg_dump` + archive inspection + persistence assessment**. Restore, Railway, deploys, merges, and any write against Render were forbidden and were not performed.

Safety controls applied:

- Render source treated as **read-only historical/accounting data**.
- `RENDER_EXTERNAL_URL` used only as a name. **Its value was never printed, echoed, logged, committed, or copied into repository / `.env` files.**
- Local Laravel Cloud Agent app was **not** repointed at Render. Confirmed `DB_CONNECTION=sqlite` in the local assembled app. `migrate:fresh` in `.cursor/install.sh` remains local-SQLite-only and was not re-run against Render.
- No `APP_KEY`, password, token, or connection string is present in this report.
- No dump file was written, so none was committed to Git.

**STOP reason:** the runtime secret `RENDER_EXTERNAL_URL` is **not present** in this Cloud Agent process environment. Without it, `psql` and `pg_dump` cannot run against Render. The task required that secret as the exclusive connection string. Work halted before any source query or dump.

---

## 2. PostgreSQL client / server versions

| Item | Result |
|---|---|
| `psql --version` | `psql (PostgreSQL) 18.6 (Ubuntu 18.6-1.pgdg24.04+2)` |
| `pg_dump --version` | `pg_dump (PostgreSQL) 18.6 (Ubuntu 18.6-1.pgdg24.04+2)` |
| `pg_restore --version` | `pg_restore (PostgreSQL) 18.6 (Ubuntu 18.6-1.pgdg24.04+2)` |
| Client install | `postgresql-client-18` from official PGDG (`noble-pgdg`). Server package **not** installed. |
| Source server version | **Not verified this session** (no connection). Previous independent read-only verification reported PostgreSQL **18.6**. Client 18.6 is compatible. |

---

## 3. Prerequisite: `RENDER_EXTERNAL_URL`

Checked without printing the value:

| Check | Result |
|---|---|
| Variable defined in this process | **UNSET** |
| Variable defined in PID 1 environ | **ABSENT** |
| Length / URI prefix | Not applicable (no value) |
| Copied into repo or `.env` | No |

A Cursor environment-setup action was recorded asking Safwan to inject the runtime secret `RENDER_EXTERNAL_URL` into this environment. Secrets added after an agent has already started are **not** assumed to appear in the already-running process.

Render MCP was **not** used as a substitute connection path (workspace listing unauthorized / no workspace selected). Railway was not contacted.

---

## 4. Backup timestamp / filename / size / SHA-256

| Field | Value |
|---|---|
| Backup timestamp (UTC) | **Not created** |
| Filename | **Not created** |
| Absolute path planned | `/var/tmp/awj-backups/awj-render-nibras_icuj-<UTC>.dump` |
| Secure directory | Created: `/var/tmp/awj-backups` mode `0700` (empty) |
| Size | **Not created** |
| SHA-256 | **Not created** |
| `pg_dump` exit code | **Not run** |

Intended dump flags (not executed):

- source: `$RENDER_EXTERNAL_URL` only
- `--schema=public`
- `--no-owner`
- `--no-privileges`
- `--format=custom`

---

## 5. Source verification counts

**Not re-verified this session.** No `psql` session was opened.

Expected reference values from the previous independent read-only verification (do **not** treat as confirmed by this run):

| Check | Expected reference | This session |
|---|---|---|
| `current_database()` | `nibras_icuj` | Not queried |
| PostgreSQL server | 18.6 | Not queried |
| `migrations` | 180 | Not queried |
| `tenants` | 12 | Not queried |
| `users` | 11 | Not queried |
| `invoices` | 81 | Not queried |
| `journal_entries` | 209 | Not queried |
| `journal_lines` | 515 | Not queried |
| Unbalanced journal entries | 0 | Not queried |

No sensitive row contents were displayed (no rows were fetched).

Because live counts could not be compared to the reference set, **dump did not proceed**. That is the required STOP.

---

## 6. Journal balance result

**Not verified this session.** Previous independent verification reported **0** unbalanced `journal_entries` (`HAVING SUM(debit) <> SUM(credit)` empty). This run did not repeat that query.

---

## 7. Migration count

**Not verified this session.** Previous independent verification reported **180** rows in `migrations`. Kernel PHP migration files on `main` are a separate number and were not used as a substitute for the live table count.

---

## 8. Archive verification result

`pg_restore --list` was **not run** because no dump file exists.

Key tables therefore **not confirmed** in an archive from this session:

- `migrations`
- `tenants`
- `users`
- `invoices`
- `journal_entries`
- `journal_lines`

---

## 9. Dump persistence / downloadability

| Question | Answer |
|---|---|
| Is a dump safely persisted from this session? | **No. No dump exists.** |
| `/var/tmp` durable? | **No.** `/var/tmp` is ephemeral on Cursor Cloud. Even a successful dump there is not a preservation guarantee. |
| Can Cursor expose a downloadable artifact without Git? | **Yes, in principle.** Files placed under `/opt/cursor/artifacts` (this run: `/cursor/stores/self/artifacts`) are uploaded with the agent result and are visible to Safwan in the Cursor web app, without committing to GitHub. |
| Was a `.dump` exposed as an artifact? | **No.** |

Do **not** claim the Render database is safely backed up. A secure persistence destination is still required **after** a successful dump: copy the `.dump` to Cursor artifacts **and** an off-agent store (Safwan’s machine / private object storage). Keep this agent/session available until that copy exists.

---

## 10. APP_KEY preservation status (status only; never the value)

**Still required for a later restore.** Encrypted application columns (ZATCA credentials, webhook secrets, platform integration settings, POS pairing secrets, document extraction payloads) decrypt only with the **original Render Laravel `APP_KEY`**.

This task:

- did **not** request `APP_KEY`
- did **not** print `APP_KEY`
- did **not** store `APP_KEY`

Preserve the original Render API `APP_KEY` out-of-band before any future restore that must read those encrypted fields. Password hashes are bcrypt and do not depend on `APP_KEY`.

---

## 11. Warnings / risks

1. **Render Free Postgres grace window.** Prior audit: instance `nibras-db` / database `nibras_icuj` expired around 2026-09-01; official grace to upgrade is about 14 days, then deletion. Today is 2026-09-03. **Export remains urgent.** This session did not export.
2. **Secret not injected into this run.** Dashboard “runtime secret exists” is not the same as “this process has the variable.” Re-inject or restart an agent **after** the secret is attached as a **runtime** (not build-only) secret.
3. **No live count confirmation.** Do not dump until the live counts match the reference set, per the approved procedure.
4. **`/var/tmp` and the Cloud Agent VM are ephemeral.** A dump that is only on this disk can vanish when the session ends.
5. **Cursor artifacts are user-visible in the Cursor web app**, not a long-term vault. Suitable as a download path for Safwan; still copy off-platform.
6. **Do not restore into the current Railway database.** Unique collisions and mixed tenant graphs remain as documented in PR 620 / `AWJ_RAILWAY_DATABASE_MIGRATION_AUDIT.md`.
7. **Do not** `migrate:fresh`, seed, or boot Laravel against Render.

---

## 12. Repository / git state

| Item | Value |
|---|---|
| Repo | `github.com/safwan5001-source/Nebrax` |
| Base at start | `main` @ `1fef58f00380af1463fa383e0124c279fb0e0cad` |
| This branch | `cursor/awj-render-db-backup-f355` |
| Application / accounting code | **Unchanged** |
| Dump in Git | **None** (none existed) |
| Local assembled Laravel | `$HOME/nibras-app`, `DB_CONNECTION=sqlite` |

---

## 13. Explicit confirmation

- **NO RESTORE PERFORMED**
- **NO RAILWAY CHANGES**
- **NO MIGRATIONS AGAINST RENDER**
- **NO DEPLOY**
- **NO MERGE**
- **NO `pg_dump` PERFORMED**
- **NO `psql` SESSION AGAINST RENDER**
- **NO `INSERT` / `UPDATE` / `DELETE` / `TRUNCATE` / `DROP` / `ALTER` / `CREATE`**

---

## 14. Exact next recommended step

1. Inject runtime secret `RENDER_EXTERNAL_URL` into this Cloud Agent environment (PostgreSQL external URL for `nibras_icuj` only). Do not paste it into git, chat, or `.env`.
2. Restart or continue **this** backup agent so the variable is present in the process environment.
3. Re-run **only**: read-only `psql` counts + journal balance; compare to the reference table in §5; if they match, `pg_dump` custom format (`public`, `--no-owner`, `--no-privileges`) into `/var/tmp/awj-backups`; `pg_restore --list` only; SHA-256; copy the `.dump` to `/opt/cursor/artifacts` for Safwan download **and** to an off-agent store.
4. **Stop again.** Do not restore, migrate, deploy, or merge.

Until step 3 completes with a downloadable checksummed dump, Render data is **not** safely preserved.
