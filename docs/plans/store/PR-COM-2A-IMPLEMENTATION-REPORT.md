# PR-COM-2A — Sales Channel Foundation — Implementation Report

## 1. Executive Summary

Adds `App\Models\SalesChannel`, the first-class, tenant-owned domain entity
answering "which commercial channel did this sale originate from" per
ADR-03. It is deliberately independent of `Branch` and `Warehouse` — no
`branch_id`, no `warehouse_id`, no fulfillment/warehouse-selection logic.
No `Service` class was added (plain Eloquent CRUD is sufficient — see §13);
no API, no UI, no routes. No built-in channels are seeded (see §12). One
pre-existing test (`CommerceModuleBoundaryTest`) was updated to reflect that
`SalesChannel` is now legitimately built, per that test's own documented
intent (see §24).

## 2. Base SHA

`5d21c04e202d9d75841940ed720af0674fb9f92a` (`origin/main` at task start —
PR-COM-1B's merge commit, confirmed via `git fetch origin main` +
`git log --oneline -5 origin/main` before branching; matches the SHA given
in the task).

## 3. Binding references

Read (targeted): `AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md` (PR-COM-2A/2B
sections), `ADR-03-CHANNEL-WAREHOUSE-FULFILLMENT-SOURCE.md` in full (the
primary binding contract), `PR-COM-0`/`PR-COM-1A`/`PR-COM-1B` implementation
reports, `app/Support/CommerceBoundary.php`. ADR-01/ADR-02 were not
re-read in full — their relevant boundary statements
(`CommerceOrder != Invoice`, `Reservation != StockMovement`) were already
internalized from PR-COM-1A/1B. Did not re-read the Existing Architecture
Audit or Evidence Passes beyond what ADR-03 itself cites, per the task's
own instruction not to re-audit — verified current-code reality directly
instead (§4).

## 4. AWJ VERIFIED findings

- **`Role`** (`app/Models/Role.php`, migration
  `2025_01_01_000075_create_roles.php`): the closest existing precedent for
  a tenant-configurable, slugged catalog entity — `slug` (plain string, no
  auto-slugify, caller-supplied verbatim), `name`, `unique(tenant_id, slug)`,
  `implements CompanyWide`, `SoftDeletes`. No `is_active`/enable-disable
  column (roles aren't disabled, only soft-deleted).
- **`PaymentMethod`** (`app/Models/PaymentMethod.php`): the closest existing
  precedent for the enable/disable lifecycle — `is_active` boolean, default
  `true`, toggled via plain `update()`, no dedicated state-machine or
  service method for the toggle itself. `implements CompanyWide` too.
- **Enum-column convention confirmed** (again, consistent with PR-COM-1B's
  finding): `products.type` (`enum('good','service')`),
  `partners.type` (`enum('customer','supplier','both')`),
  `stock_permits.status`, `inventory_reservations.status` (PR-COM-1B) all
  use a real DB `enum()` column for small fixed vocabularies, not a plain
  string with app-level validation. Followed for `sales_channels.type`.
- **`tenant_id` + secondary key uniqueness convention**: `roles.slug`,
  `accounts.code`, `cost_centers.code`, `branches.code`, `warehouses.code`
  all use `unique(['tenant_id', <key>])` — confirms the same literal key
  value is expected to be reusable across different tenants by design (not
  globally unique), matching exactly what the task's test requirement #3
  needs.
- **`app/Models/` is flat** (reconfirmed, third time across COM-1A/1B/2A):
  no domain subdirectory exists; `setup.sh`/`ci.yml`/`deploy/assemble.sh`
  already flat-copy it, so no assembly-script change was needed.
- **Three reflection-based "every model" guards exist** (found the hard way
  in PR-COM-1B, checked proactively this time before writing any code):
  `BranchIsolationGuardTest` (every `BaseModel` subclass must declare
  `BranchScoped`/`BelongsToBranch`/`CompanyWide`), `NumberingSettingsTest`
  (every model using `GeneratesDocumentNumbers` must appear in
  `DocumentNumberingCatalog::ENTITIES`), `ProductReferenceClassificationGuardTest`
  (every model with a `product_id` column must appear in
  `ProductReferenceRegistry`). `SalesChannel` satisfies the first
  automatically (`implements CompanyWide`) and is exempt from the other two
  (no `GeneratesDocumentNumbers` trait, no `product_id` column) — verified
  before writing the model, not discovered as a surprise this time.
- **`CommerceModuleBoundaryTest::NOT_YET_MODELS`** (from PR-COM-0) literally
  names `App\Models\SalesChannel` as one of the classes it asserts do not
  exist yet. Its own docblock: "ليست قائمة عامة لكل صنف Commerce ممكن — هذا
  الاختبار يحرس وعد PR-COM-0 بعدم إدخالها الآن، لا يمنع بناءها لاحقاً في
  PR-COM-1A+" (not a permanent ban — guards PR-COM-0's promise not to
  introduce them *before their time*). Confirmed via a full test run this
  was the *only* place `SalesChannel` was referenced anywhere in the
  existing test suite before this PR.
- **PostgreSQL/pcntl availability**: unchanged from PR-COM-1B — a real
  PostgreSQL 16 server was available (started via `pg_ctlcluster`), and
  `pcntl` remains present. Not newly needed for this PR (no concurrency
  concern — see §16), but re-verified PR-COM-1B's own concurrency test
  still passes against this PR's schema (§21).

## 5. SalesChannel domain definition

`SalesChannel` answers exactly one question: *which commercial channel did
this sale originate from?* It does not answer *which warehouse fulfills
it* — that is Fulfillment Policy's job (PR-COM-2B, explicitly out of scope
here). It carries no reference to any accounting document, no reference to
inventory, and no reference to a fulfillment location of any kind.

## 6. Why SalesChannel != Branch != Warehouse

- **`Branch`** is an AWJ organizational/operational unit — numbering scope,
  permissions, reporting, accounting context. A `SalesChannel` has none of
  these concerns; it is `CompanyWide`, never branch-scoped, and carries no
  `branch_id` column at all (verified absent from both the migration and
  the model's `$fillable`, and asserted by a dedicated test, §17).
- **`Warehouse`** is the physical inventory fulfillment source (per ADR-02/
  PR-COM-1A/1B). A `SalesChannel` carries no `warehouse_id` column either
  (same verification), and does not read or write `ProductWarehouseStock`,
  `InventoryReservation`, or any inventory table (§16).
- ADR-03 §1 states this explicitly: "A Channel must not be modeled as
  merely a synonym for Branch or Warehouse." This PR's schema has zero
  columns that could conflate the three.

## 7. Data model / schema

`database/migrations/2026_09_13_010000_create_sales_channels_table.php` —
one new table, `sales_channels`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `tenant_id` | uuid, FK `tenants`, cascade | auto-filled by `BelongsToTenant` |
| `slug` | string | stable machine-readable identity, caller-supplied verbatim |
| `name` | string | human-readable |
| `type` | enum(`web`,`mobile`,`pos`,`external`) | see §10 |
| `is_active` | boolean, default `true` | see §11 |
| `created_at`, `updated_at` | timestamp | |
| `deleted_at` | timestamp, nullable | `SoftDeletes` |

Constraint: `unique(tenant_id, slug)` — the only index added (see §19 for
why no secondary index was added).

`app/Models/SalesChannel.php`: `extends BaseModel implements CompanyWide`,
`use SoftDeletes`, `$fillable = [tenant_id, slug, name, type, is_active]`,
type constants `TYPE_WEB`/`TYPE_MOBILE`/`TYPE_POS`/`TYPE_EXTERNAL`. No
methods beyond the standard Eloquent surface — no invariant complex enough
to justify one (§13).

## 8. Tenant ownership / isolation

`SalesChannel extends BaseModel`, so `TenantScope` filters every query
automatically and `tenant_id` is auto-filled on create by `BelongsToTenant`
— no `tenant_id` parameter is ever accepted from a caller anywhere in this
diff, and **no `withoutGlobalScope(TenantScope::class)` or
`withoutGlobalScopes()` appears anywhere in this diff** (grep-verified,
same standard as every prior Commerce PR). Verified with negative tests
(§17): Tenant B sees zero of Tenant A's channels; the identical literal
`slug` string is independently usable by two different tenants without
collision; a duplicate `slug` *within* the same tenant is rejected at the
DB constraint level (`unique(tenant_id, slug)`).

## 9. Stable identity strategy

`slug` (plain `string`, not auto-generated from `name`, not transformed by
any `Str::slug()`-style normalization) — the caller supplies the exact
machine-readable identity they want, mirroring `Role::$slug` precisely
(§4). No UUID-only identity was used for external-facing reference because
a UUID is not "stable and human-legible" in the sense the task asked for
(a future integration or config file referencing `"web"` is far more
durable/readable than referencing a raw UUID); no auto-slugification logic
was added because none exists anywhere in the codebase for this shape of
entity and inventing one would be exactly the kind of new, unproven
convention the task told me not to invent.

## 10. Type strategy

DB `enum('web', 'mobile', 'pos', 'external')` — the four categories ADR-03
§1 itself names as examples (AWJ Web Store, «متجرنا» Mobile, AWJ POS,
Salla/Zid/Shopify as `external`). This is a deliberately minimal,
defensible starting vocabulary directly grounded in the ADR's own text, not
an invented taxonomy — ADR-03 §17 explicitly leaves "channel type enum
values" as an unapproved, deferred decision, so this is documented here as
a **DERIVED**, extensible implementation choice (extending it later is a
normal additive migration, exactly as `products.type` or
`inventory_reservations.status` could be extended). No provider-specific
type values (`salla`, `zid`, `shopify` as literal enum members) were added
— those map to `external` for now; per-provider distinction is explicitly
deferred to external-channel integration work (§16 of this report / §16 of
the task).

## 11. Lifecycle strategy

`is_active` boolean, default `true`, toggled via a plain `update(['is_active' => ...])`
call — matching `PaymentMethod`'s exact convention (§4), not a new
state-machine. No `enable()`/`disable()` service method was added because
none is needed: there is no invariant beyond flipping one column (unlike
PR-COM-1B's reservation lifecycle, which genuinely needed transition
guards because moving *out of* `active` has real consequences for ATS).
`SoftDeletes` is used for the "gone" case (matching `Role`'s convention),
so a channel is never hard-deleted by default, and — since no `CommerceOrder`
or any other model references `sales_channels` yet — there is currently no
historical-order-orphaning concern to design around; that concern becomes
real only once a future PR introduces a real FK from orders/reservations to
channels, at which point it will decide the correct delete-restriction
policy with real data in view.

## 12. Built-in / default-channel decision

**No built-in channels are seeded.** Investigated the existing
"tenant-owned defaults" convention: `PaymentMethod` auto-seeds four rows
(bank transfer, cash, cheque, credit card) on tenant registration — but
that seeding exists because `PaymentMethod` is *immediately consumed* by
POS/Payment flows the moment a tenant registers (a payment cannot be
recorded without one existing). `SalesChannel` has **no consumer at all**
in this PR (no `CommerceOrder`, no API, no UI, per explicit scope
exclusion) — seeding rows nothing reads would be exactly the kind of
speculative, unused data the task's own instructions warn against
("PR-COM-2A لا يعتبر مكتملًا إلا إذا... لا synthetic legacy channel"), and
would also require deciding *now* which channels/slugs/types are "the"
defaults — a decision ADR-03 explicitly defers (§17: "whether
PRIORITY_LOCATIONS ships..." and the whole channel taxonomy question).
`SalesChannel` foundation therefore ships empty; a future PR seeds channels
only once an actual Commerce flow needs one to exist.

## 13. Service boundary decision

**No `SalesChannelService` was created.** The only operations this PR
needs — create, tenant-scoped uniqueness (enforced by the DB constraint,
not application code), toggle `is_active` — are all plain Eloquent
operations with no cross-cutting invariant to centralize. This mirrors
PR-COM-0's own "don't build a Service for a Model" guidance and the
task's explicit instruction (§11): a Service is warranted only when real
invariants need centralizing, and none exist yet. This PR is, as permitted,
"Domain foundation + tests" only.

## 14. API impact

**NONE.** No route, controller, request, or resource file was added or
touched.

## 15. Inventory / Reservation impact

**NONE.** `SalesChannel` never calls `AvailableToSellService` or
`InventoryReservationService`, never reads or writes
`product_warehouse_stock`, `inventory_reservations`, or `stock_movements`.
Verified by dedicated tests: creating and toggling a channel leaves
`InventoryReservation::count()` and `StockMovement::count()` at `0`.
PR-COM-1B's `AvailableToSellService`/`InventoryReservationService` code was
not touched at all in this diff.

## 16. Accounting impact

**NONE.** `SalesChannel` never calls `LedgerService` and creates no
`Account`/`JournalEntry`/`JournalLine`. Verified by a dedicated test:
`JournalEntry::count() === 0` after creating and toggling a channel.
`InvoiceService`, `PaymentService`, `PurchaseService`, `ReturnService` were
not touched.

## 17. ZATCA impact

**NONE.** No ZATCA class, route, or table referenced. A dedicated test
additionally confirms zero `Invoice` rows are created by any
`SalesChannel` operation.

## 18. Backward compatibility

No existing document is retroactively assigned a channel, no synthetic
"legacy" channel was created, and no file in `InvoiceService`,
`PosService`/POS checkout, `PurchaseService`, `ReturnService`,
`StockPermitService`, or `Warehouse`/`Branch` models was touched — verified
directly (`git status --porcelain`, §26) and by the full representative
regression run (§22) showing an identical pass count to PR-COM-1B's own
baseline for the same filter (127/127).

## 19. Changed files

```
A  app/Models/SalesChannel.php
A  database/migrations/2026_09_13_010000_create_sales_channels_table.php
A  tests/Feature/SalesChannelTest.php
M  tests/Feature/CommerceModuleBoundaryTest.php   (NOT_YET_MODELS: SalesChannel removed — §24)
```

No `setup.sh`/`ci.yml`/`deploy/assemble.sh` change — `app/Models/` and
`tests/Feature/` are already flat-copied (§4). No existing table was
altered — the migration is purely additive (one new table). Only one index
was added (`unique(tenant_id, slug)`, required for the tenant-scoped
identity invariant itself); no secondary index (e.g. on `type` or
`is_active`) was added because no query shape in this PR — there being no
API/service beyond plain CRUD — justifies one yet; adding one speculatively
would be exactly the "future-proofing column/index without proven need"
the task told me not to do.

## 20. Tests / results — SQLite

`tests/Feature/SalesChannelTest.php`, 12 tests, all passing (see §17 for
the full list of assertions per required case). Full command:
`php artisan test --filter=SalesChannelTest` → **PASS 12/12 (19
assertions)**.

## 21. Tests / results — PostgreSQL

Same file, same command, against a real local PostgreSQL 16 instance
(same setup as PR-COM-1A/1B — `pg_ctlcluster 16 main start`, database
`nibras`/`nibras`/`secret` matching `ci.yml`'s service block) →
**PASS 12/12 (19 assertions)**, identical to SQLite.

Additionally re-ran PR-COM-1B's `InventoryReservationPostgresConcurrencyTest`
**3 consecutive times** against this PR's full schema (with
`sales_channels` present) to confirm the reservation atomicity guarantee is
completely unaffected by this PR — all 3 runs: PASS 3/3 (11 assertions)
each time, identical outcome to PR-COM-1B's own report.

## 22. Regression results

All run against the generated app assembled from this core (commit
`b867443`).

| Tier | Command | Engine | Result |
|---|---|---|---|
| 1 — new SalesChannel tests | `--filter=SalesChannelTest` | SQLite | PASS 12/12 |
| 1 — new SalesChannel tests | `--filter=SalesChannelTest` | PostgreSQL | PASS 12/12 |
| 2 — CommerceModuleBoundaryTest | `--filter=CommerceModuleBoundaryTest` | SQLite | PASS 4/4 (fixed — §24) |
| 3 — BranchIsolationGuardTest | (combined run below) | PostgreSQL | PASS |
| 4 — ApiTenantIsolationTest | (combined run below) | PostgreSQL | PASS |
| 5 — COM-1A (`AvailableToSellServiceTest`) | (combined run below) | PostgreSQL | PASS |
| 6 — COM-1B functional (`InventoryReservationServiceTest`) | (combined run below) | PostgreSQL | PASS |
| 7 — COM-1B PostgreSQL concurrency | `--filter=InventoryReservationPostgresConcurrencyTest` | PostgreSQL | PASS 3/3, ×3 runs |
| 8 — tenant/model guards (`ProductReferenceRegistryTest`, `ProductLifecycleTest`, `NumberingSettingsTest`) | (combined run below) | PostgreSQL | PASS |
| 9 — full SQLite suite | `php artisan test` | SQLite | 2935 passed, 25 failed, 11 skipped |
| 10 — full PostgreSQL suite | `php artisan test` | PostgreSQL | 2946 passed, 25 failed, 0 skipped |

Combined tiers 3–6+8 command:
`--filter='SalesChannelTest|CommerceModuleBoundaryTest|BranchIsolationGuardTest|ApiTenantIsolationTest|AvailableToSellServiceTest|InventoryReservationServiceTest|ProductReferenceRegistryTest|ProductLifecycleTest|NumberingSettingsTest'`
→ **PASS 110/110 (511 assertions)** on PostgreSQL.

Representative Invoice/Purchase/Return/StockPermit/Warehouse/POS/Ledger
regression (same filter as PR-COM-1A/1B's own reports):
`--filter='InventoryTest|WarehouseTest|WarehouseAwareDocumentsTest|StockPermitTest|StockPermitUomValuationTest|PurchaseTest|ReturnTest|InvoiceInventoryApiTest|PosCheckoutTest|LedgerTest'`
→ **PASS 127/127 (902 assertions)** on PostgreSQL — identical count to
PR-COM-1B's own report for the same filter.

### Full-suite reconciliation (both engines, no unexplained count)

- **PostgreSQL**: 2946 − 2934 (PR-COM-1B's own pgsql baseline) = **12** =
  exactly `SalesChannelTest`'s test count.
- **SQLite**: 2935 − 2923 (PR-COM-1B's own sqlite baseline) = **12** =
  same. Skips unchanged at 11 (8 pre-existing + 3 PR-COM-1B concurrency
  tests, still correctly skipping on this engine).
- **Failures**: 25 on both engines, byte-for-byte identical test names to
  PR-COM-1B's already-triaged, environment-caused baseline (missing
  `bcmath` extension → 24 `Fuel*Test` failures; 1 `DocumentCenterSecureIntakeTest`
  PDF-fixture gap). None touch Commerce, Inventory, Invoice, Ledger,
  Payment, ZATCA, POS, or any isolation/guard test.

## 23. CI status

Not pushed through GitHub Actions in this task (per instructions: do not
merge, do not deploy). All commands above were run locally against a real,
separately-installed PostgreSQL 16 instance configured with the exact same
credentials `ci.yml`'s `services.postgres` block uses, and against SQLite
via the same `setup.sh`-equivalent assembly this repo's own CI uses.

## 24. Guard findings / fixes

**One guard update was required, not a defect fix**:
`CommerceModuleBoundaryTest::NOT_YET_MODELS` (a PR-COM-0 test) literally
lists `App\Models\SalesChannel` among the classes it asserts must not exist
yet. Once this PR legitimately introduces `SalesChannel`, that specific
assertion fails by design — the class now exists, exactly as the roadmap
always intended it eventually would. The test's own docblock states this
explicitly (quoted in §4): it guards PR-COM-0's promise not to introduce
these classes *before their time*, not a permanent prohibition. Removed
`App\Models\SalesChannel` from that list with a comment explaining why,
leaving the other three still-forbidden classes (`CommerceOrder`,
`Reservation`, `PaymentIntent`) and `CommerceListing` untouched — this PR
does not introduce any of those. Re-ran `CommerceModuleBoundaryTest` after
the fix: PASS 4/4.

**No other guard broke.** Unlike PR-COM-1B (where a guard
—`ProductReferenceClassificationGuardTest`— was missed until the full
suite ran), this time all three known reflection-based "every model"
guards (`BranchIsolationGuardTest`, `NumberingSettingsTest`,
`ProductReferenceClassificationGuardTest`) were checked proactively before
writing the model (§4), and the full-suite run confirmed no other
regression — the only failure the full suite surfaced was the expected,
by-design `CommerceModuleBoundaryTest` assertion described above.

## 25. Risks / open questions

- **OPEN / REQUIRES VERIFICATION** — the exact channel `type` vocabulary
  (§10) is a defensible starting point grounded in ADR-03's own examples,
  not an ADR-approved taxonomy (ADR-03 §17 explicitly defers this). A
  future PR introducing external-channel integrations may need additional
  types or a different representation (e.g., a separate `provider` column
  alongside `type`) — flagged here rather than assumed settled.
- **OPEN / REQUIRES VERIFICATION** — no delete-restriction policy exists
  yet for a channel referenced by real data, because nothing references
  `sales_channels` yet. Once PR-COM-2B (or later, `CommerceOrder`)
  introduces a real foreign key to `sales_channels`, that PR must decide
  the correct `ON DELETE` behavior and whether `ProductReferenceRegistry`-style
  classification is needed for a *channel*-reference registry (not
  applicable today since `SalesChannel` carries no `product_id`).
- No STOP condition was triggered: no `TenantScope` bypass was needed, no
  `Branch`/`Warehouse` semantics were touched, no POS/Invoice/accounting
  behavior changed, no fulfillment policy was built ahead of its PR, and
  every ambiguity encountered (identity strategy, type vocabulary, seeding)
  had a defensible, documented answer grounded in existing convention
  rather than a genuine blocking unknown.

## 26. Remaining work

Per the master plan, strictly next in sequence (not started, per explicit
instruction not to begin it in this task): `PR-COM-2B` — Channel
Fulfillment Policy (`FIXED_LOCATION` V1, channel↔warehouse eligibility
mapping, routing succeeds only when reservation succeeds). Also
everything else in the task's "Absolute Out of Scope" list (`PickupLocation`,
`CommerceListing`, Price Resolver, Promotion Engine, `CommerceOrder`,
Cart/Checkout, Customer Account, Mobile/Public API, `PaymentIntent`,
Shipping, Invoice bridge, Returns redesign, external integrations, B2B,
Product Variants, Storefront/ERP UI). The two §25 open questions are
conscious, documented deferrals, not blockers.

## 27. Git

- **Branch:** `claude/pr-com-2a-sales-channel`
- **PR:** opened against `main` — link recorded in a follow-up commit to
  this report
- **Base SHA:** `5d21c04e202d9d75841940ed720af0674fb9f92a`
- **Head SHA:** `b867443d8a79f9a86d5a3ebca6e67e61170aaaca` (before adding
  this report)

## 28. Recommended next step

**PR-COM-2A is clean**: `SalesChannel` is a genuine first-class,
tenant-owned domain entity; its stable `slug` identity is tested for
tenant-scoped uniqueness and cross-tenant reuse; tenant isolation is
proven with zero new `TenantScope` bypass; it has zero coupling to
`Branch` or `Warehouse` (no columns, no logic, tested explicitly); no
synthetic/seeded channel was forced into existence; no fulfillment logic
was built; no inventory, accounting, or ZATCA effect exists; no API/UI was
added; backward compatibility is preserved (verified by regression);
SQLite and PostgreSQL tests are both green against the same pre-existing
failure baseline; PR-COM-1B's PostgreSQL concurrency guarantee was
re-verified unaffected. The one guard update
(`CommerceModuleBoundaryTest`) was a by-design, documented consequence of
this PR doing exactly what the roadmap always intended, not a defect.

Recommended next step: **`PR-COM-2B` — Channel Fulfillment Policy**, once
this PR is reviewed and merged by its owner (not by this session — per
instructions, this session does not merge or deploy).
