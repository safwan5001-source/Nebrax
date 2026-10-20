# REM-18b: Shared ICV/PIH chain and credit-note posting (architecture, revision 2: final design gate)

> **Implementation note (REM-18b-1, added when this design was committed).** REM-18b-1 implements §4 T1–T7 (+T8, entry/document tenant
> consistency) and the §7 schema. One correction to the text below, recorded in `REM-18b-1-IMPLEMENTATION-REPORT.md`: `previous_hash` /
> `hash` are `varchar(255)` (a PIH is the Base64 of the 64-character hex digest, 88 characters), not the `varchar(64)` of §3.1. Everything
> else (F1/F2, allocator, activation, rollout protocol) is **not** part of 18b-1.


| | |
|---|---|
| Mode | **Design only.** No repository code, migration, commit, PR, merge, deploy or ZATCA call. The DB behaviour claims marked **[V-probe]** were checked on a **throwaway** PostgreSQL 16 database (`rem18b_probe`, dropped afterwards) and an in-memory SQLite 3.45.1, using hand-written SQL that mirrors the proposed schema. No project migration was executed. |
| Base | `origin/main` = `45e95b23ea36f78a95a0d267f343b8b120df1a96` (REM-18a merged, #1583). |
| Revision 2 scope | Owner-raised risks only: **(1)** deletion/immutability, **(2)** rolling-deployment safety, **(3)** legacy PIH continuity. Revision-1 content is kept where still valid and marked *superseded* where replaced. |
| Labels | **[V]** = verified in code/config at the base SHA (file:line). **[V-probe]** = verified on a throwaway DB. **[P]** = proposal. **[O]** = owner decision. **[U]** = unresolved regulatory question. |
| Gate verdict | **GO for REM-18b-1 (schema-only)**, subject to owner decisions O-9 (migration approval) and O-R1 (deletion policy). See §13 for the exact conditions. |

---

## 0. What changed since revision 1

| Revision 1 | Revision 2 |
|---|---|
| UPDATE trigger only; DELETE left to model guards (O-8) | **DB-enforced append-only**: row UPDATE and DELETE blocked, TRUNCATE blocked. The only deletion path is the existing **tenant purge cascade**, unchanged (§3). |
| "Drift guard" in application code | **Database fence F1** on `invoices` (installed by REM-18b-2) rejects any ZATCA chain write that has no matching shared-chain entry, so old binaries **fail closed** (§5). |
| Platform env switch for notes | **DB-backed activation row read inside the posting transaction**, plus fence F2 on `credit_notes` so pre-REM-18b-3 binaries cannot post sales notes once its migration runs (§5). |
| Legacy seed in application code | Seeding **verified by a DB trigger** (`seed_icv = max(invoices.zatca_icv)` of the tenant), with a formal transition specification (§6). |
| — | **New finding F-6:** today's chain-head query can pick a NULL-ICV invoice on PostgreSQL (§1.6). |

---

## 1. Verified findings (file/line evidence)

### 1.1 Posting paths and locks (revision 1, unchanged) [V]

* Invoice: `Invoice FOR UPDATE` → `LedgerService::post` → `AccountingDateGuard` locks the **`Tenant` anchor** → COGS (`InventoryState FOR UPDATE`) → `ZatcaService::buildFor` (re-locks the tenant, reads the head, hashes, signs) → `update()` writes `zatca_*`. References: `InvoiceService.php:888-1076`, `LedgerService.php:43-90`, `AccountingDateGuard.php:158-161`, `ZatcaService.php:42-119`.
* Credit note: `CreditNote FOR UPDATE` → source `Invoice FOR UPDATE` → tenant anchor; no ZATCA (`CreditNoteService.php:121-191, 213-229`).
* Chain head today: `Invoice::whereNotNull('zatca_hash')->orderByDesc('zatca_icv')->first()`, `icv+1`, PIH = hash of the **stored XML** (`ZatcaService.php:80-86, 166-178`). Malformed XML ⇒ `RuntimeException` (`ZatcaInvoiceHasher.php:75-81`). Missing XML ⇒ throws (`ZatcaService.php:172-174`).
* Single invoice issuer: `InvoiceService.php:1044` is the only `buildFor(` call site and the only writer of `zatca_icv/hash/previous_hash/uuid/xml/qr` (`InvoiceService.php:1052-1074`). Besides that, only `zatca_cleared_xml` is written later (`ZatcaSubmissionDispatcher.php:62`).

### 1.2 Deletion and retention [V]

| Fact | Evidence |
|---|---|
| `Tenant` uses **SoftDeletes**; no application path deletes a tenant, soft or hard | `Tenant.php:8,14`; no `delete`/`forceDelete` on `Tenant` in `app/` (`grep`). The platform tenant controller has `index/show/update` only (`PlatformTenantController.php:21-41`). |
| Hard `DELETE FROM tenants` exists **only in PostgreSQL test cleanup** | e.g. `AccountingPeriodLockConcurrencyTest.php:86`, `FiscalYearConcurrencyTest.php:93`, `AiBudgetConcurrencyTest.php:60` |
| Tenant FKs are `cascadeOnDelete` throughout (271 occurrences), incl. `invoices`, `credit_notes`, `zatca_credentials`, `tenant_application_events` | migrations, e.g. `000018:20`, `000131:13`, `000086:33` |
| `credit_notes.original_invoice_id` is `restrictOnDelete` | `2026_11_04_020000` (tested in `CreditNoteSourcePostgresTest.php:250-300`) |
| Invoice API delete = **drafts only** | `InvoiceController.php:338-344` → `InvoiceService::deleteDraft` (`InvoiceService.php:461-476`) |
| No delete/cancel path for posted credit notes | `CreditNoteService.php` |
| Append-only precedents: model guards (`TenantApplicationEvent.php:21-25`); DB triggers on both engines (`2026_11_10_010000_create_communication_messages_tables.php:215-280`) | |
| Retention rule: tax documents ≥ 6 years after the tax period (IR Art. 66(1)); retention classes / legal hold are **REM-36** (P2) | evidence register row 57; backlog row 5.10 |

### 1.3 Deletion semantics [V-probe, PostgreSQL 16 and SQLite 3.45.1]

| # | Probe | Result |
|---|---|---|
| D1 | Today's shape (tenant cascade + `credit_notes.original_invoice_id RESTRICT`): hard-delete a tenant that has a note referencing its invoice | **succeeds**; the cascade removes both. Tenant purge is not blocked today. |
| D2 | Proposed entries: `tenant_id CASCADE`, `invoice_id`/`credit_note_id` `RESTRICT`: hard tenant delete | **succeeds**, entries removed by the cascade |
| D3 | `BEFORE DELETE` row trigger "raise **if the owning tenant row still exists**" | direct `DELETE` **blocked**; tenant purge cascade **allowed** (the parent row is already gone when the child trigger fires), on both engines |
| D4 | `TRUNCATE zatca_chain_entries` (PostgreSQL) | bypasses row triggers; **blocked** only with a `BEFORE TRUNCATE` statement trigger. SQLite has no TRUNCATE. |
| D5 | Direct `DELETE FROM invoices` of a referenced invoice | blocked by the RESTRICT FK |
| D6 | Soft delete of a tenant is an `UPDATE` of `tenants` | entries unaffected |

### 1.4 Deployment model [V]

* Migrations run at **every container boot, before Apache starts** (`deploy/entrypoint.sh:67-84`, five attempts; boot aborts on failure). The new release's migrations are therefore live while a previous instance may still be serving, if the host overlaps instances (Render zero-downtime / Railway). The overlap itself is host behaviour and **not verified**.
* `GET /api/health` returns only `{"status":"ok"}` (`HealthController.php:15`). No build identity is exposed, so the instance version cannot be checked from outside.
* `QUEUE_CONNECTION=sync` in production (CLAUDE.md), so there are no long-running workers with old code. Every invoice writer is a web request.

### 1.5 Concurrency test infrastructure [V]

Real-process PostgreSQL tests use `pcntl_fork` and **skip** when `pcntl` is missing (`InvoiceIssuedAtPostgresTest.php:44-50, 125-150`). The PR #1583 pgsql CI log tail shows `invoices_tenant_id_zatca_icv_unique` violations exercised by tests. Whether the `pcntl` suites ran or were skipped in CI is **not verified** (§10 makes the new suite fail instead of skipping).

### 1.6 NEW finding F-6: head query and NULL ordering on PostgreSQL [V + V-probe]

`ZatcaService.php:80-83` orders by `zatca_icv DESC`. On PostgreSQL, **NULLs sort first** in DESC order (probe: rows `(icv 1, 2, NULL)` with non-null hash return the NULL row first; SQLite returns ICV 2). A posted invoice with `zatca_hash NOT NULL` and `zatca_icv NULL` could therefore become the head on PostgreSQL. That shape is possible only for data posted between migrations `000012` (hash) and `000013` (ICV), or after manual writes. Current code writes both columns together (`InvoiceService.php:1069-1071`), so new data cannot have this shape. Severity: **latent, data-dependent, PostgreSQL only**. REM-18b must not inherit it: the seed uses `max(zatca_icv)`, which ignores NULLs (§6). This report does not fix today's code path. That would be a separate one-line change for the owner to schedule (O-R7).

---

## 2. Regulatory basis (revision 1, unchanged)

Verified: one counter across invoices **and associated notes**; one chain per EGS unit; no gaps; rejected documents keep their ICV; a note without an original reference violates Art. 54 ([DG-EN] §5.6 p.28, FAQ pp.61-62; [DTG] FAQ; register rows 45-48). Unresolved, not decided here: U1 chain scope per VAT number vs per unit (DP-R2, D-06), U2 `PaymentMeansCode` for credit settlement, U3 party snapshot reuse, U4 Invoice vs CreditNote root, U5 multiple original invoices, U6 non-15 % categories, U7 official signature-policy values.

---

## 3. Recommended deletion and retention policy [P]

### 3.1 Options compared

| Option | Prevents unauthorised deletion | Tenant purge | Silent loss of signed metadata | Changes existing behaviour | Verdict |
|---|---|---|---|---|---|
| A. Model guards only (revision 1) | no (raw SQL, `DB::table`, TRUNCATE bypass) | unchanged | possible | no | rejected |
| B. `tenant_id RESTRICT` on the chain tables | yes | **hard purge fails** once a tenant issued a document; PG test cleanups (`DELETE FROM tenants`) would fail | no | **yes**: changes tenant purge, needs approval and test rework | not now (REM-36) |
| C. Retention table / archive-on-purge copy | partial (only chain metadata survives; the XML on `invoices` is purged anyway) | unchanged | reduced | adds a new retention concept | belongs to REM-36 |
| **D. Cascade parity + conditional DELETE trigger + TRUNCATE trigger + RESTRICT document FKs + model guards** | **yes**, for every path except purge of the owning tenant | **unchanged** (D1-D3) | only through an explicit hard tenant purge, which already destroys the invoices themselves today | **no** | **recommended** |

### 3.2 Recommended design D

1. **FKs:** `tenant_id` → `tenants` **CASCADE** (parity with `invoices`/`credit_notes`); `chain_id` → `zatca_chains` **RESTRICT**; `invoice_id` / `credit_note_id` → **RESTRICT** (a document with an entry can never be deleted alone; D5).
2. **Row UPDATE on `zatca_chain_entries`:** always rejected (both engines).
3. **Row DELETE on `zatca_chain_entries` and `zatca_chains`:** rejected **unless the owning tenant row no longer exists** (`EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)` ⇒ raise). This lets the existing purge cascade complete and blocks every other deletion (D3). Soft-deleted tenants still exist, so their chains stay protected (D6).
4. **TRUNCATE:** `BEFORE TRUNCATE` statement triggers on both tables (PostgreSQL; SQLite has none) (D4).
5. **Model guards** (`updating`/`deleting` throw), as in `TenantApplicationEvent.php:21-25`, give a clear error before reaching the DB.
6. **Retention is not decided here.** Hard tenant purge stays an out-of-band DBA action and keeps destroying all tax records (invoices included), exactly as today. Blocking purge for six years is a REM-36 decision (option B or C there), recorded as **O-R1**.

Owner approval needed: **O-R1** (accept D now, defer purge blocking to REM-36). No existing tenant-deletion behaviour changes.

---

## 4. Database constraints and trigger strategy [P]

All triggers ship in **both** PostgreSQL (plpgsql functions) and SQLite (`WHEN … RAISE(ABORT)`) variants, following the precedent in `2026_11_10_010000`. Every behaviour below was reproduced in the probes.

| ID | Table / event | Rule | Installed by |
|---|---|---|---|
| T1 | `zatca_chain_entries` BEFORE UPDATE | reject | 18b-1 |
| T2 | `zatca_chain_entries` BEFORE DELETE | reject while `tenants.id = OLD.tenant_id` exists | 18b-1 |
| T3 | `zatca_chain_entries`, `zatca_chains` BEFORE TRUNCATE (PG) | reject | 18b-1 |
| T4 | `zatca_chain_entries` AFTER INSERT | `UPDATE zatca_chains SET last_icv = NEW.icv WHERE id = NEW.chain_id AND tenant_id = NEW.tenant_id AND last_icv = NEW.icv - 1`; no row ⇒ raise. **The entry and its head move atomically; gaps, skips and cross-tenant entries are impossible** (probe: skip ⇒ raised, duplicate ⇒ unique violation) | 18b-1 |
| T5 | `zatca_chains` BEFORE UPDATE | identity columns frozen; `NEW.last_icv = OLD.last_icv + 1` **and** an entry `(chain_id, icv = NEW.last_icv)` exists; otherwise raise (probe: direct head bump ⇒ raised) | 18b-1 |
| T6 | `zatca_chains` BEFORE INSERT (seed) | `chain_key = 'tenant'` and `last_icv = seed_icv = COALESCE(max(invoices.zatca_icv) of NEW.tenant_id, 0)`; otherwise raise (probe: wrong seed or unknown key ⇒ raised; tenant without ICV ⇒ seed 0) | 18b-1 |
| T7 | `zatca_chains` BEFORE DELETE | as T2 | 18b-1 |
| F1 | `invoices` BEFORE INSERT/UPDATE | if any of `zatca_icv/hash/previous_hash/uuid/xml` is being **set** (was NULL): an entry must exist with `invoice_id = NEW.id`, the same `icv`, `previous_hash`, `hash`, `zatca_uuid`, and a chain of the same tenant. If they are being **changed** after being set: reject. `zatca_cleared_xml` and every other column stay writable (probe: legacy-style write ⇒ fenced; dispatcher write ⇒ allowed; tampering a signed field ⇒ rejected; mismatched hash ⇒ rejected) | **18b-2** |
| F2a | `credit_notes` BEFORE UPDATE | same as F1 for the note's ZATCA columns, keyed on `credit_note_id` | 18b-3 |
| F2b | `credit_notes` BEFORE UPDATE | a `type = 'sales'` row may change to `status = 'posted'` only with `zatca_status IS NOT NULL` (`generated` · `not_generated` · `disabled`). Older binaries never set it, so they cannot post sales notes once the migration has run. | 18b-3 |
| U | indexes | `UNIQUE(tenant_id, chain_key)`; `UNIQUE(chain_id, icv)`; `UNIQUE(invoice_id)`; `UNIQUE(credit_note_id)`; `UNIQUE(tenant_id, zatca_uuid)`; PG `CHECK` exactly one of `invoice_id`/`credit_note_id`, `document_type` matching the FK set, `icv > 0` | 18b-1 |

Notes:
* T6 reads `max(zatca_icv)` (NULLs ignored), which removes F-6 from the new path.
* F1 deliberately does **not** compare `hash` with a re-hash of the XML: historical rows legitimately keep older raw hashes (`ZatcaService.php:160-165`). Consistency of new entries is asserted in application code and tests (§10).
* `chain_key` other than `tenant` is rejected by T6 until REM-25 or a verified branch scope changes T6 in its own migration.

---

## 5. Rolling-deployment safety protocol [P]

### 5.1 Threat model

| Writer | Risk after notes are enabled | Control |
|---|---|---|
| Pre-18b-2 binary (head = `max(invoices)+1`) | reuses an ICV already taken by a note ⇒ fork | **F1**: it cannot write `zatca_icv` without an entry. It never writes entries, so its invoice posting rolls back (fail closed). |
| 18b-2 binary (allocator, no note issuance) | posts a sales note without e-invoice artifacts | **F2b**: rejected after the 18b-3 migration |
| Any raw SQL / script | arbitrary chain edits | T1-T7, F1, F2a |
| Lazy seeding race (two first postings) | duplicate or stale head | tenant anchor serialises; `UNIQUE(tenant_id, chain_key)`; T6 verifies the seed |

A feature flag is not relied on for chain safety: chain safety comes **only** from the database (F1, T4-T6). The activation row in §5.3 decides only whether sales notes are e-invoiced.

### 5.2 Ordered rollout with verification gates

| Phase | Ships | Effect while an older instance still serves | Gate before the next phase (read-only SQL / checks) |
|---|---|---|---|
| G0 baseline | — | — | Snapshot per tenant: `max(zatca_icv)`, `count`, and SHA-256 of `zatca_xml` for every posted invoice (exported **off-DB**, read-only). Full test suite green on both engines. |
| P1 (18b-1) | tables, T1-T7, nullable `credit_notes` columns, models | none; no existing path touches the new tables | Q1 tables/triggers present (`pg_trigger`); Q2 zero chain rows; Q3 G0 checksums unchanged |
| P2 (18b-2) | allocator for invoices **+ F1** in the same migration | old instance's invoice postings **fail closed** for the overlap window (no fork, no partial write). New instances seed lazily under the tenant lock. | Q4 `invoices` with `zatca_icv > chain.seed_icv` and no entry = **0**; Q5 every chain `last_icv = max(entries.icv)` or `seed_icv`; Q6 `count(entries) = last_icv - seed_icv`; Q3 checksums of rows with `icv ≤ seed_icv` unchanged; PG concurrency suite green |
| P3 (18b-3) | note issuance code, F2a/F2b, activation row **off** | pre-18b-3 instances cannot post sales notes (F2b fail closed); invoices unaffected | Q7 sales notes posted after the migration with `zatca_status IS NULL` = 0; staging tenant end-to-end (SDK + OpenSSL); activation row still off |
| A (activation) | one `UPDATE` of the activation row by a platform administrator, audited | effective at the next posting transaction; no deploy | Q4-Q7 again after the first notes; chain walk test (§10 C-12) on a canary tenant |

Owner choice **O-R3**: accept the short fail-closed window in P2 (old instances cannot post invoices for the overlap) or deploy P2 in a maintenance window. Either way there is no corruption path.

### 5.3 Activation, emergency disablement, rollback

* **Activation row** [P]: `zatca_rollout_controls(key PK = 'credit_note_issuance', enabled boolean, changed_by_platform_administrator_id, changed_at, reason)` plus an append-only events table (model guards + T1-style trigger). The note-posting code reads it **inside the posting transaction after the tenant anchor**, so activation is atomic per transaction (no request half before and half after). Alternative: reuse `platform_integration_settings` (key `zatca_credit_notes`, `enabled`; migration `000119:12-19`). That needs no new table but couples ZATCA rollout to AI integration settings (**O-R2**).
* **Emergency disablement:** set `enabled = false`. Sales notes then post as `zatca_status = disabled`, no ICV consumed: today's behaviour, explicit and queryable. If the owner prefers notes to be **blocked** while disabled for credential-configured tenants, that matches O-2 (b) (**O-R4**). Invoices are never disabled by this switch.
* **Rollback:**

| Target | Before any `credit_note` entry exists | After the first `credit_note` entry |
|---|---|---|
| Code back to 18b-2 | safe | safe (shared head; F2b blocks notes ⇒ fail closed) |
| Code back to pre-18b-2 | invoice posting fails closed (F1). To restore it, F1's `down()` may be run: it **refuses unless no `credit_note` entry exists in any chain**. Entries then equal the invoice ICVs, so `max(invoices)+1` is correct again. | **Forbidden.** F1 `down()` refuses, and old code would reuse note ICVs. Fix forward only. |
| Schema `down()` of 18b-1 | refuses if any chain or entry row exists | refuses |

* **Detection of legacy writes:** impossible by construction after P2 (F1). Q4-Q7 run as post-deploy gates and as a scheduled read-only consistency report (a later slice; not activation-critical).

### 5.4 Optional, not required for safety

Setting PostgreSQL `application_name` to `awj-api@<git-sha>` (config) would let operators list the live versions in `pg_stat_activity` before activation. It is useful for operations only and is not a safety mechanism (**O-R5**).

---

## 6. Legacy PIH transition: formal specification [P, proven against T4-T6/F1]

### 6.1 Definitions (per tenant, `chain_key = 'tenant'`)

* `L` = set of invoices with `zatca_icv IS NOT NULL` when the chain is seeded (legacy); `m = max(L.icv)`, or 0 when `L = ∅`.
* Head `H = (seed_icv, last_icv)`; entries `E = {e_k}`.
* `doc(e)` = the invoice or credit note referenced by `e`; `xml(d)` = its stored `zatca_xml`; `h(x)` = `ZatcaInvoiceHasher::hash(x)`; `G` = BR-KSA-26 genesis (`ZatcaService.php:212-215`).

### 6.2 Transition rules

| Step | Rule |
|---|---|
| Seed (first allocation, inside the posting tx, under the tenant anchor) | insert `H` with `seed_icv = last_icv = m` (T6 verifies `m` against the DB) |
| Previous document `P` for the next allocation | if `last_icv = seed_icv = 0` ⇒ none (PIH = `G`); if `last_icv = seed_icv > 0` ⇒ the **unique** invoice with `zatca_icv = seed_icv` (exact equality, not `max`/ORDER BY); if `last_icv > seed_icv` ⇒ `doc(e)` where `e.icv = last_icv` |
| Fail closed | `P` missing; `P.zatca_hash` NULL; `xml(P)` NULL/blank (`ZatcaService.php:172-174` semantics); `h(xml(P))` throws (malformed/DTD, `ZatcaInvoiceHasher.php:75-81`) ⇒ the whole posting rolls back |
| Allocate | `icv = last_icv + 1`; `PIH = h(xml(P))` or `G` |
| Commit (same tx) | insert `e(icv, PIH, hash, uuid, doc)` **before** the document update (F1 requires it); T4 advances `H`; then the document row stores the same values (F1 checks equality) |

### 6.3 Proof obligations

| # | Property | Argument |
|---|---|---|
| P1 | First new entry uses the correct historical XML hash | When `last_icv = seed_icv = m > 0`, `P` is the invoice with `icv = m`, unique by `UNIQUE(tenant_id, zatca_icv)` (`000053:69`) and verified against the DB by T6. `PIH = h(xml(P))` is identical to `ZatcaService.php:86, 166-178` today. |
| P2 | Never falls back to an outdated invoice once entries exist | T5 allows `last_icv` only to grow by +1 with a matching entry, and T1/T2 make entries permanent. Once `last_icv > seed_icv` the legacy branch is unreachable forever. |
| P3 | Missing/malformed/inconsistent historical XML fails closed | §6.2 fail-closed list; nothing is written because everything is in one transaction (probe: rollback leaves no head or entry). |
| P4 | No historical ICV reused | new ICVs ≥ `m+1` > every legacy ICV; `UNIQUE(chain_id, icv)` across documents; F1 forbids invoice ICVs outside `E`; legacy and new invoice ICVs also stay under `UNIQUE(tenant_id, zatca_icv)`. |
| P5 | Legacy genesis compatible | chains that began with `LEGACY_GENESIS_HASH` (`ZatcaService.php:202`) are continued from their stored XML, never repaired (REM-25). An empty legacy uses `G`, as today. |
| P6 | No signed historical document rewritten | F1 rejects changes to set ZATCA fields; the seed only reads; Q3 checksums gate every phase. |
| P7 | No orphaned head or consumed ICV after failure | the seed, entry and head update all happen in the posting transaction; T4/T5 tie the head to entries (probe: failed insert or update ⇒ head unchanged; full rollback ⇒ no head). |
| P8 | Byte-identical invoices across the cutover | P1 + same ICV ⇒ same inputs to `buildXml`; parity test (§10 C-4). |

### 6.4 Historical data states (decided per state, never rewritten)

| State | Behaviour |
|---|---|
| Contiguous legacy 1..m | normal seed |
| Gaps in legacy ICVs (count < m) | seed still `m`; seed metadata records `legacy_count`; **no repair** (O-R6: report-only vs block) |
| Rows with `zatca_hash` but `zatca_icv` NULL (F-6 shape) | not chain members; excluded by `max()`; recorded in seed metadata |
| `P` lacks XML or hash | posting fails closed with a coded error (same as today for missing XML) |

---

## 7. Schema (revision 1 §3, updated) [P]

`zatca_chains`: `id`, `tenant_id` (CASCADE), `chain_key`, `last_icv`, `seed_icv`, `seed_legacy_count`, `seed_excluded_null_icv`, `seeded_at`, timestamps; `UNIQUE(tenant_id, chain_key)`. Revision 1's `last_entry_id` is dropped: the previous entry is read by `UNIQUE(chain_id, icv)`.

`zatca_chain_entries`: as revision 1 (`chain_id`, `icv`, `document_type`, `invoice_id` | `credit_note_id`, `type_code`, `subtype`, `zatca_uuid`, `previous_hash`, `hash`, `signed`, `issued_at`, `created_at`), with the constraints in §4. Both models are `CompanyWide`.

`credit_notes` (nullable, additive): `zatca_status`, `zatca_skip_reason`, `zatca_document_type`, `zatca_reason_code`, `issued_at`, `party_snapshot`, `zatca_uuid`, `zatca_icv`, `zatca_previous_hash`, `zatca_hash`, `zatca_qr`, `zatca_xml`. In 18b-1 they are columns only; F2a/F2b arrive in 18b-3.

Credit-note integration (revision 1 §4.2/§5) is unchanged, except that the activation row replaces the env switch and the entry is inserted **before** the note update (F2a).

---

## 8. Lock order (revision 1 §4.1, confirmed)

`document row → [posted source invoice] → tenant anchor → (account_balances, inventory_states) → zatca_chains head (explicit FOR UPDATE; T4's UPDATE re-takes the same lock) → activation row (read)`. T4-T6 and F1 add no lock on any other document row. T6's `max(invoices.zatca_icv)` is a read under the tenant anchor that already serialises the tenant's postings. Cross-tenant work shares nothing.

---

## 9. Risks and mitigations (updated)

| Risk | Mitigation |
|---|---|
| Two trigger dialects drift | One test suite runs every trigger case on both engines (§10 T-series) |
| P2 fail-closed window blocks invoices on old instances | O-R3: low-traffic slot or maintenance window; no data risk |
| Rollback below 18b-2 after the first note | forbidden by F1 `down()`; documented runbook; fix forward |
| Hard tenant purge destroys tax records | unchanged behaviour; REM-36 (O-R1) |
| F-6 on today's code path before 18b-2 | separate fix (O-R7); 18b-2 replaces the path anyway |
| Trigger cost on hot `invoices` updates | F1 short-circuits unless ZATCA columns change; one indexed lookup on posting |
| `pcntl` suites silently skipped in CI | new suite asserts `pcntl` on pgsql CI and fails instead of skipping |

---

## 10. Test plan

### 10.1 Trigger/constraint tests (SQLite + PostgreSQL, deterministic)

| ID | Case |
|---|---|
| T-1 | entry UPDATE ⇒ rejected |
| T-2 | entry/head DELETE with existing tenant ⇒ rejected; soft-deleted tenant ⇒ still rejected |
| T-3 | hard tenant purge ⇒ succeeds, chain rows gone (cleanup parity) |
| T-4 | TRUNCATE ⇒ rejected (PG) |
| T-5 | entry with icv ≠ head+1, duplicate icv, other tenant's chain ⇒ rejected |
| T-6 | head bump without entry, identity change ⇒ rejected |
| T-7 | seed ≠ legacy max, unknown `chain_key` ⇒ rejected; tenant without ICV ⇒ seed 0 |
| T-8 | F1: legacy-style write fenced; dispatcher `zatca_cleared_xml` allowed; tamper of a set field rejected; mismatched entry values rejected |
| T-9 | F2a/F2b: note artifact tamper rejected; sales note posted without `zatca_status` rejected; purchase note unaffected |
| T-10 | document with an entry cannot be deleted (RESTRICT) |
| T-11 | migrations up/down; `down()` refusals (§5.3) |

### 10.2 Chain behaviour (SQLite + PostgreSQL)

| ID | Case |
|---|---|
| C-1 | empty tenant: invoice ⇒ ICV 1, PIH = `G`; note first ⇒ ICV 1, PIH = `G` |
| C-2 | legacy 1..m (incl. a `LEGACY_GENESIS_HASH` chain) ⇒ next = m+1, PIH = h(xml(m)) |
| C-3 | legacy invoice → entry → invoice → credit note → invoice: ICVs m+1..m+4, each PIH = h(previous stored XML, across tables) |
| C-4 | parity: identical deterministic invoices on old vs new code ⇒ identical XML bytes |
| C-5 | `P` without XML / malformed XML / without hash ⇒ fail closed; nothing written |
| C-6 | F-6 shape present ⇒ seed ignores the NULL-ICV row; PIH from the true max |
| C-7 | gaps in legacy ⇒ seed m, metadata recorded, no rewrite |
| C-8 | historical rows: G0-style checksums identical after many new postings |
| C-9 | accounting/inventory regression: journal lines, balances, REM-02 caps, COGS unchanged |
| C-10 | tenant isolation: tenant A cannot read/advance B's chain |
| C-11 | eligibility statuses (purchase, standalone, credit refund, unknown subtype, missing snapshot) consume no ICV |
| C-12 | chain walk: for every entry `k > seed`, `previous_hash(k) = h(xml(doc(k-1)))` |

### 10.3 PostgreSQL concurrency and rollback (`pcntl_fork`, real processes; **fails** if `pcntl` is missing on pgsql CI)

| ID | Case |
|---|---|
| PG-1 | N parallel invoice + note posts, one tenant ⇒ contiguous ICVs, valid C-12 walk, no `40P01` |
| PG-2 | two first postings on an unseeded tenant ⇒ one seed, both succeed in sequence |
| PG-3 | parallel tenants ⇒ independent chains, no cross-tenant waits |
| PG-4 | child killed (`SIGKILL`) after `reserve`, before commit ⇒ PG rollback; head unchanged; next posting gets the same ICV the failed one would have had (no gap, no reuse of a committed value) |
| PG-5 | exception injected after entry insert (signing failure) ⇒ rollback; no entry, no head change, note/invoice draft, no journal entry |
| PG-6 | "old binary" simulation (raw update of `zatca_icv` without entry) racing new postings ⇒ fenced, never a duplicate |
| PG-7 | activation flipped mid-load ⇒ each transaction sees one consistent value; no half-issued note |
| PG-8 | lock-order guard: a test fails if any code path locks `zatca_chains` before the tenant anchor (static scan + runtime ordering assertion) |

### 10.4 External validators

Notes and invoices produced by the real posting path, stamped with the ephemeral credential: SDK GLOBAL PASSED (the zero-rate REM-12 gap stays) and independent OpenSSL signature checks.

Before every PR: the full `php artisan test` (no filter) and the journal-entry table required by CLAUDE.md. REM-18b creates **no new journal entry type**.

---

## 11. Updated owner decisions

| # | Decision | Recommendation |
|---|---|---|
| O-1 | Chain partition key now | `tenant` (U1 open) |
| O-2 | Credit-settled sales notes while D4 is open | Phase-1 tenants: `not_generated`; credential tenants: reject or adviser-supplied code; never invent |
| O-3 | Standalone sales notes | as O-2 |
| O-4 | Party snapshot | copy from source (U3 open) |
| O-5 | `reason_code` for pre-release drafts | required at post for issuable notes (coded 422) |
| O-6 | API additions | approve (additive) |
| O-7 | Extend the invoice write-once guard | **superseded by F1** (DB-level) |
| ~~O-8~~ | ~~DELETE trigger~~ | **replaced by O-R1** |
| O-9 | Approve migration M1 (18b-1) | required for GO |
| O-R1 | Deletion policy D (§3.2) now; purge blocking/retention under REM-36 | approve D |
| O-R2 | Activation storage | dedicated `zatca_rollout_controls` (+ events) vs reuse `platform_integration_settings` |
| O-R3 | P2 fail-closed window vs maintenance window | low-traffic slot; either is safe |
| O-R4 | Emergency disable semantics | `disabled` status quo vs block for credential tenants |
| O-R5 | `application_name` with build SHA | optional ops aid |
| O-R6 | Legacy ICV gaps at seed | report-only (no repair) vs block |
| O-R7 | Fix F-6 on today's code before 18b-2 | separate one-line PR (`whereNotNull('zatca_icv')`), or rely on 18b-2 |
| O-10 | `reason` 255/500 mismatch | separate PR |

---

## 12. Revised PR boundaries

| PR | Contains | Must not contain | Behaviour change |
|---|---|---|---|
| **REM-18b-1** schema only | `zatca_chains`, `zatca_chain_entries`, T1-T7 (both engines), PG CHECKs and indexes, nullable `credit_notes` columns, models (`CompanyWide`, guards), `down()` refusals, T-1…T-7, T-10, T-11 tests | F1, F2, allocator, any change to `ZatcaService`/`InvoiceService`/`CreditNoteService`, any API change | **none** (no existing code reads or writes the new objects) |
| **REM-18b-2** shared allocator | `ZatcaChainAllocator`, `ZatcaService` uses it (lazy seed, §6), F1 migration with guarded `down()`, rollout gates Q1-Q6 as a read-only artisan check, T-8, C-1…C-10, C-12, PG-1…PG-6, PG-8 | note issuance, F2 | invoices: same outputs; non-allocator writers fenced |
| **REM-18b-3** note issuance | wiring in `CreditNoteService::post`, F2a/F2b, activation row (O-R2) default off, `reason_code` input, additive resource fields, eligibility statuses, T-9, C-11, PG-7, SDK/OpenSSL notes | activation itself (a separate, owner-approved operational step) | sales notes need a ZATCA decision to post |

---

## 13. GO / NO-GO: REM-18b-1 (schema only)

**GO**, conditional on:

1. **O-9** migration approval and **O-R1** deletion policy D.
2. The PR stays inside the 18b-1 row of §12: in particular **F1 is not included** (F1 would block the current invoice path).
3. Its tests cover T-1…T-7, T-10, T-11 on **both** engines, and the full suite is green on SQLite and PostgreSQL in CI.
4. `down()` refuses whenever chain rows exist. At 18b-1 time none can exist, so the migration is fully reversible.

Why it is safe: purely additive objects that no existing code path touches; no change to `invoices`, journals, VAT, inventory or tenant-deletion behaviour; no backfill and no historical read-modify-write.

**NO-GO triggers** (any one stops the PR): a need to alter or re-sequence existing `invoices` data; a tenant-FK behaviour change (option B) without REM-36 approval; any accounting or tax-policy change; inability to express T1-T7 on SQLite. **None applies to the design above.**

---

## 14. Base SHA and next action

* Base SHA: `45e95b23ea36f78a95a0d267f343b8b120df1a96`.
* Next action: the owner answers **O-9, O-R1** (gate for 18b-1); **O-R2…O-R7** before 18b-2/18b-3; **O-2…O-6** before 18b-3.

**STOP. NO CODE CHANGES. NO MIGRATION EXECUTION. NO COMMIT. NO PR. NO MERGE. NO DEPLOY. NO LIVE ZATCA TRANSMISSION.**
