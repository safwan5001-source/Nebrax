# REM-18b-2: Implementation report: shared ICV/PIH allocator + legacy writer fence F1

| | |
|---|---|
| Status | **Draft PR. NOT merged, NOT deployed, no production migration, no live ZATCA transmission.** Branch `claude/rem-18b-2-allocator-f1`. PR number, Head SHA and CI results are posted on the PR (this file cannot name its own SHA). |
| Authority | Owner instruction "REM-18b-2 — Shared ICV/PIH Allocator + Legacy Writer Fence F1", built on `REM-18b-SHARED-CHAIN-DESIGN.md` (revision 2) and the merged schema of REM-18b-1. |
| Base | `origin/main` = `481e4f20779eca908d969dc5b5b2ec6e8a3a2d92` (contains the REM-18b-1 merge `117f4e2`). |
| Scope | Invoices only: allocator on the existing chain schema, wiring in `ZatcaService` / `InvoiceService::post`, F1 triggers on `invoices` (both engines), tests, docs. |
| Not in this PR | Credit-note issuance · F2 · debit notes (383) · branch/EGS chains (REM-25) · activation row · dispatch (stays disabled) · any historical document rewrite or backfill · any new journal entry. |

## 1. Phase A: design checkpoint (before coding)

**Verdict: GO.** Each answer was checked against the code on the base commit and against the merged REM-18b-1 triggers.

| # | Question | Finding |
|---|---|---|
| 1 | Existing ICV/PIH path | One writer only: `InvoiceService::post` → `ZatcaService::buildFor`. The old head was `Invoice::whereNotNull('zatca_hash')->orderByDesc('zatca_icv')->first()`, run after the tenant lock; ICV = head + 1; PIH = hash of the head's stored XML (genesis when none). The columns are then written by `$invoice->update([...])` in the same transaction. No other app code writes `zatca_icv`. |
| 2 | REM-18b-1 triggers | T4 (AFTER INSERT on entries) advances the head in the inserting statement, so a failed insert leaves the head as it was. T5 allows the head to move only by +1 with a matching entry. T6 accepts a seed only equal to `max(invoices.zatca_icv)` of that tenant. T7 makes the head permanent while the tenant exists. All of them run inside the caller's transaction, so a rollback removes the seed, the entry and the head move together. |
| 3 | Posting and signing compatibility | The allocator returns the same ICV and PIH the old rule produced for every non-F-6 data state. `buildXml`, signing and QR are unchanged, so the XML is byte-identical for the same inputs (tested by reflection against the previous rule). |
| 4 | How F1 rejects old writers but not the allocator | The allocator inserts the entry **before** updating the invoice row, in the same transaction. F1 accepts an ICV write only when an entry with the same invoice id, tenant, ICV, UUID, previous hash and hash already exists. The old binary never writes entries, so its update fails and its whole posting rolls back. No flag, session variable or bypass exists. |
| 5 | Order of writes | lock invoice row → lock tenant anchor (`LedgerService`) → lock or seed the chain head → build and sign → insert entry (T4 advances the head) → update invoice (F1 checks the entry) → commit. |
| 6 | PostgreSQL locking | Every writer (old or new) locks the tenant anchor before reading the ICV, so writers of one tenant are serialised. Under READ COMMITTED each statement after the lock sees all committed work. `UNIQUE(tenant_id, chain_key)`, `UNIQUE(chain_id, icv)` and T4/T6 reject anything the lock order misses. Proven by the five fork-based PostgreSQL tests (§4). |
| 7 | Can the fence tell a legitimate write from an old one without a bypass? | Yes: the only distinguishing fact is the presence of the matching entry, which only the new code writes, in the same transaction. Nothing else is trusted. |
| 8 | Legacy invoices with NULL ICV, missing XML, inconsistent hashes | NULL ICV rows are not chain members: `max()` ignores them (this fixes F-6) and the count is recorded in `seed_excluded_null_icv`. Missing, blank, malformed or DTD XML of the previous document fails closed. Legacy hash columns are never trusted or rewritten; PIH is always the hash of the stored XML, as before. |
| 9 | Rolling deployment with migrations at boot | `deploy/entrypoint.sh` runs migrations before Apache starts, so F1 is live before any new instance serves. During the overlap an old instance keeps working for tenants without a chain head (its `max+1` equals the future seed, and T6 absorbs it). For a tenant that already has a head, its invoice posting fails closed until it is replaced. No ICV can be reused and no fork is possible. |

### Refinements to the approved F1 design (deviations, all safer or equal)

| Design (§4 F1) | Implemented | Reason |
|---|---|---|
| Fence every ICV write | Fence only tenants that already have a chain head (A) | Before a head exists the invoices table is the only chain, the old writer's `max+1` is correct, and T6 forces the seed to absorb it. Fencing all tenants would block old instances everywhere during the overlap without adding safety. Once a head exists it cannot disappear (T7). |
| Freeze `zatca_xml` / `zatca_hash` / `zatca_qr` after they are set | Freeze only the chain identity of invoices that have an entry: `zatca_icv`, `zatca_uuid`, `zatca_previous_hash` (B) | Existing pre-dispatch tamper detection (TaxN01, `ZatcaSubmissionDispatcher` tests) depends on these columns staying writable, and the dispatcher writes `zatca_cleared_xml`. Chain integrity does not depend on them: the entry hash is immutable (T1), and the allocator compares `hash(stored XML)` of the previous entry document with it and fails closed on mismatch. Freezing issued XML in the database is listed as a separate hardening decision (§6). |
| — | PIH for the next document = `hash(stored XML)` of the previous entry document, verified equal to `entry.hash` | Same rule as today (PIH from stored XML), plus a check the old code did not have. |

## 2. Changed files

| File | Kind | Purpose |
|---|---|---|
| `app/Services/Accounting/ZatcaChainAllocator.php` | new | `reserve()` (lock head or seed lazily, ICV and PIH), `recordInvoice()` (insert entry), legacy transition, fail-closed checks |
| `app/Services/Accounting/ZatcaChainSlot.php` | new | Value object passed from `reserve()` to `record()` |
| `app/Services/Accounting/ZatcaService.php` | modified | `buildFor` takes ICV/PIH from the allocator (old head query, branch/tenant lock block and `previousInvoiceHash()` removed); new `record()`; returns `signed` and `slot` |
| `app/Services/Accounting/InvoiceService.php` | modified | `post()` calls `$this->zatca->record($invoice, $zatca)` before the invoice update (one call, no other change) |
| `database/migrations/2026_11_19_010000_add_zatca_chain_fence_to_invoices.php` | new | F1 triggers only (PostgreSQL function + trigger; three SQLite triggers); guarded `down()` |
| `tests/Feature/ZatcaChainAllocatorTest.php` | new | Behaviour, parity, legacy transition, fail-closed, rollback, isolation, F1, mixed-version (both engines) |
| `tests/Feature/ZatcaChainAllocatorPostgresTest.php` | new | Five fork-based PostgreSQL concurrency tests; **fails (does not skip)** on PostgreSQL if `pcntl`/`posix` are missing |
| `tests/Feature/ZatcaChainSchemaTest.php` | modified | Rollback round trips now take F1 down first; the "nothing uses the tables" guard becomes "only the allocator writes the chain, credit notes are not wired" |
| `tests/Feature/ZatcaSignedInvoicePostingTest.php` | modified | Legacy pre-REM-17 genesis test now inserts its legacy row before the tenant opens a chain (the old raw ICV write is fenced afterwards, as intended) |
| `tests/Feature/ZatcaCreditNoteXmlTest.php` | modified | Fix of a latent defect in REM-18a tests: `fail()` inside `try { } catch (RuntimeException)` was swallowed (`AssertionFailedError` extends `RuntimeException`). Rethrown now; all tests still pass |
| `CLAUDE.md`, task queue, backlog row 3.3 | docs | Status |

Untouched: `Invoice`/`CreditNote` models and `$fillable`, `CreditNoteService`, REM-18b-1 migrations, routes, resources, dispatch, fixtures, SDK harness. **No accounting entry is created or changed**: the allocator writes only `zatca_chains` and `zatca_chain_entries`; the invoice journal entry (debit 1130 / credit 4110 + 2120, plus COGS) is exactly as before.

## 3. Schema and trigger compatibility

* F1 adds triggers only: no column, index or row change. Existing invoice rows are not read or written by the migration.
* PostgreSQL: `invoices_zatca_chain_fence()` as `BEFORE INSERT OR UPDATE OF zatca_icv, zatca_uuid, zatca_previous_hash, zatca_hash`. Updates of other columns (status, payment fields, `zatca_cleared_xml`, `zatca_xml`, `zatca_qr`) do not fire it.
* SQLite: `invoices_zatca_chain_fence_insert`, `invoices_zatca_chain_fence_update`, `invoices_zatca_chain_identity`, with the same cases tested on both engines.
* Existing tests that write ICVs directly (DocumentNumbering, ZatcaIcvScope) target tenants without a chain or already expect a `QueryException`, so they are unaffected.
* PostgreSQL cleanups that hard-delete a test tenant still work: tenant cascade removes heads and entries (T2/T7 allow it once the tenant row is gone).
* `down()` refuses if any entry exists ("Rollback refused…"); otherwise drops the triggers only. Round trip up → down → up tested on empty chains.

## 4. Tests and results (local; CI is the authority)

New cases: first invoice opens at ICV 1 with the BR-KSA-26 genesis; standard and simplified share one chain (chain walk); ICV/PIH/XML byte parity with the previous rule; legacy → new continuity from the stored XML (not the raw hash column); legacy pre-REM-17 genesis chain continued, rows untouched; F-6 row (hash, NULL ICV) ignored and counted; missing/blank/malformed/DTD previous XML fails closed with no head, entry or journal entry; previous XML changed after issue stops the chain; independent tenant chains; failure after signing rolls back entry and head and the same ICV is reissued; double posting rejected; foreign tenant refused; no submission attempt; F1 rejects old-writer update, ICV-only update, insert with ICV, and copied entry values while the allocator passes; chain identity frozen while `zatca_cleared_xml` and `zatca_hash` stay writable; mixed-version rollout (old writer allowed before the head, seed continues it, fenced after, other tenant unaffected); F1 rollback refused after the first entry. PostgreSQL forks: six concurrent postings form one contiguous valid chain; two concurrent first postings create one head; two tenants in parallel stay independent; a failed posting and a SIGKILLed child mid-transaction consume no ICV; an old writer racing the allocator is always fenced, with no deadlock.

| Run | Result |
|---|---|
| `ZatcaChainAllocatorTest` + `ZatcaCreditNoteXmlTest` + `ZatcaChainSchemaTest`, SQLite | 85 passed, 1 skipped (PostgreSQL-only TRUNCATE) |
| `ZatcaChainAllocatorPostgresTest`, PostgreSQL 16 | 5 passed, 143 assertions |
| Allocator, schema, credit-note XML, signed posting, Phase 2, DocumentNumbering, IcvScope, PostgreSQL | 125 passed |
| `--filter 'Postgres\|Concurrency'`, PostgreSQL, `PGOPTIONS='-c lock_timeout=60s'` | 168 passed |
| Drift, real-service parity, monetary, party and signing tests | 100 passed; fixtures unchanged |
| Full suite, SQLite | 7944 passed, 27 failed, 151 skipped (69244 assertions). The 27: 26 `Fuel*` + `AiPaidProviderDisabledTest` (environmental, below) |
| Full suite, PostgreSQL (`PGOPTIONS='-c lock_timeout=60s'`, as CI) | 8091 passed, 27 failed, 4 skipped (70570 assertions). The 27: 26 `Fuel*` + `StorefrontMediaApiTest` (environmental, below). The five concurrency tests ran (not skipped) and passed |

The expected local-only failures are the 26 `Fuel*` tests (`bcmath` is not installed in this container; CI has it), `AiPaidProviderDisabledTest` (also fails on main in this container) and, on PostgreSQL, `StorefrontMediaApiTest` (`PDOException HY093`, also fails without this change; recorded in the REM-18b-1 report).

## 5. SDK and independent signature validation

Local run of the conformance harness with the official ZATCA SDK and fixtures stamped at run time by the production signing classes (synthetic ephemeral credential): `rc=0`, official samples 19/19, independent OpenSSL crypto checks 19/19, 20 AWJ signed fixtures with no problem, no mutation-control problem; Python harness 101 OK. Fixture drift tests pass unchanged: the allocator does not alter XML. CI runs `zatca-sdk-conformance.yml` on this PR because `app/Services/Accounting/Zatca*` changed. GLOBAL PASSED is SDK conformance evidence, not ZATCA acceptance.

## 6. Risks and unresolved decisions

| Item | State |
|---|---|
| Old instances during deployment (O-R3) | For tenants with a chain head their invoice posting fails closed until replaced. No data risk. A low-traffic slot is recommended; no maintenance window is needed for chain safety. |
| Issued XML not frozen in the database | By decision (§1). A changed XML of the latest entry document blocks the next posting (fail closed, outage not fork). Changing the XML of the **last legacy** invoice before the first allocation cannot be detected (no trusted legacy hash), which is today's behaviour. Database freezing of `zatca_xml`/`zatca_hash` after issue is a separate hardening slice that must first rework the tamper-detection test fixtures. |
| Legacy ICV gaps at seed (O-R6) | Report-only: seed is `max`, `seed_legacy_count` records the count. No repair. |
| `application_name` with build SHA (O-R5) | Not implemented; detection uses F1 errors (runbook §8.4). |
| Activation row and emergency disable for notes (O-R2, O-R4) | REM-18b-3. Invoices have no switch by design. |
| F-6 on the old path (O-R7) | Fixed in the new path (`max()`); the old path is removed. |
| Hard tenant deletion vs six-year retention | Unchanged; REM-36. |
| Credit notes D4/D5, 383, branch/EGS (REM-25), non-15 % categories (REM-12) | Unchanged and open. |

## 7. Branch, PR, SHAs

Branch `claude/rem-18b-2-allocator-f1`; Base `481e4f20779eca908d969dc5b5b2ec6e8a3a2d92`; Draft PR number, Head SHA and CI are on the PR.

## 8. Deployment and rollback runbook (not executed; owner approval required)

### 8.1 Pre-deployment read-only verification (production replica or read-only role)

```sql
-- Q0 schema of REM-18b-1 present, F1 absent
SELECT tgname FROM pg_trigger WHERE tgrelid IN ('zatca_chains'::regclass, 'zatca_chain_entries'::regclass, 'invoices'::regclass) AND NOT tgisinternal ORDER BY 1;
-- Q1 nothing in the chain yet
SELECT (SELECT count(*) FROM zatca_chains) AS heads, (SELECT count(*) FROM zatca_chain_entries) AS entries;
-- Q2 per-tenant legacy shape (seed preview, gaps, F-6 rows)
SELECT tenant_id, max(zatca_icv) AS seed, count(zatca_icv) AS with_icv,
       count(*) FILTER (WHERE zatca_icv IS NULL AND zatca_hash IS NOT NULL) AS null_icv_hashed
  FROM invoices GROUP BY tenant_id ORDER BY tenant_id;
-- Q3 the last legacy invoice of each tenant has XML (otherwise its next posting will fail closed)
SELECT i.tenant_id, i.id FROM invoices i
  JOIN (SELECT tenant_id, max(zatca_icv) m FROM invoices GROUP BY tenant_id) x ON x.tenant_id = i.tenant_id AND i.zatca_icv = x.m
 WHERE i.zatca_xml IS NULL OR btrim(i.zatca_xml) = '';
-- G0 checksums, exported off-DB and kept
SELECT id, tenant_id, zatca_icv, md5(coalesce(zatca_xml,'')) AS xml_md5, zatca_hash, zatca_previous_hash, zatca_uuid
  FROM invoices WHERE zatca_icv IS NOT NULL ORDER BY tenant_id, zatca_icv;
```

Q3 must return no row, or the owner must accept that those tenants cannot post invoices until the XML question is resolved (no automatic repair).

### 8.2 Activation order

1. REM-18b-1 schema is already deployed (Q0).
2. Deploy REM-18b-2. The container entrypoint runs `2026_11_19_010000` before Apache starts, so F1 is active before the first new request.
3. Each tenant's chain is seeded by its first invoice posting on a new instance. Nothing is seeded at deploy time.

### 8.3 Write barrier

No maintenance window is required for chain safety: the database (F1 + T4–T7 + tenant anchor lock) is the barrier. A feature flag is not relied on. Recommended: deploy in a low-traffic slot so the overlap in which old instances fail closed for chain tenants is short.

### 8.4 Detecting old instances

Application logs or failed requests containing `ZATCA ICV written without a matching shared-chain entry` come from a pre-REM-18b-2 binary (or a script) writing an ICV for a chain tenant. They stop once all instances are replaced. Each one is a rolled-back posting (no partial write); the user can retry.

### 8.5 Post-deployment gates (read-only)

```sql
-- Q4 must be 0: invoices above the seed without an entry
SELECT count(*) FROM invoices i JOIN zatca_chains c ON c.tenant_id = i.tenant_id
 WHERE i.zatca_icv > c.seed_icv AND NOT EXISTS (SELECT 1 FROM zatca_chain_entries e WHERE e.invoice_id = i.id);
-- Q5 must return no row: head equals the last entry or the seed
SELECT c.id FROM zatca_chains c
 WHERE c.last_icv <> coalesce((SELECT max(icv) FROM zatca_chain_entries e WHERE e.chain_id = c.id), c.seed_icv);
-- Q6 must return no row: no gaps
SELECT c.id FROM zatca_chains c
 WHERE (SELECT count(*) FROM zatca_chain_entries e WHERE e.chain_id = c.id) <> c.last_icv - c.seed_icv;
-- Q7 must return no row: entry and invoice agree
SELECT e.id FROM zatca_chain_entries e JOIN invoices i ON i.id = e.invoice_id
 WHERE (e.icv, e.zatca_uuid, e.previous_hash, e.hash) IS DISTINCT FROM (i.zatca_icv, i.zatca_uuid, i.zatca_previous_hash, i.zatca_hash);
```

Re-run the G0 export and compare: every pre-existing row must be identical.

### 8.6 Rollback and forward fix

| Situation | Action |
|---|---|
| No entry exists yet (`SELECT count(*) FROM zatca_chain_entries` = 0) | Code may go back to pre-18b-2 after `migrate:rollback --step=1` removes F1. In production a head is committed only together with its first entry (seed, entry and invoice update share the posting transaction), so there is no head either; check Q1 before rolling back. |
| At least one entry exists | **Rollback to pre-REM-18b-2 code is prohibited.** F1 `down()` refuses. If old code were deployed anyway, its postings for chain tenants are fenced (outage, not corruption). Fix forward only. |
| Allocator defect after entries exist | Forward fix in a new release; F1 keeps every old or faulty writer from forking the chain meanwhile. There is no switch to disable the chain for invoices. |
| Never | Delete or update entries or heads, drop F1 by hand, reset ICVs, or rewrite historical XML/hash/PIH. |

Rollback becomes prohibited at the first committed row in `zatca_chain_entries`, which is the first invoice posted by a REM-18b-2 instance.

## 9. Recommended next step

Review this Draft PR. Then answer O-R2 and O-R4 (activation storage, emergency semantics for notes) and O-2…O-6, and start **REM-18b-3**: credit-note issuance through the same allocator, F2a/F2b, activation row off by default.

**STOP for review. NO MERGE. NO DEPLOY. NO PRODUCTION MIGRATION. NO LIVE ZATCA TRANSMISSION. NO HISTORICAL DOCUMENT REWRITE.**
