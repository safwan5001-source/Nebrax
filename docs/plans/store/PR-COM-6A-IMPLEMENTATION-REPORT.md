# PR-COM-6A — Commerce ↔ Shared Customer Platform Context Integration — Implementation Report

**Status:** Implemented, P1 review finding fixed on the same PR/branch.

## 1. Executive Summary

Commerce's only current write path, `CommerceOrderService::create()`, now
derives an order's optional `Partner` reference from
`App\Tenancy\CustomerContext` whenever an authenticated customer context is
established, instead of trusting the caller-supplied `partner_id`. Guest,
staff, and internal callers — none of which ever establish
`CustomerContext` — keep PR-COM-5A's exact prior behavior for the ownership
decision, **except** that the previously implicit trust extended to *every*
contextless caller has been replaced by an explicit, caller-set
`trustedPartnerSelection` flag (§21 — P1 fix). No new authentication,
identity model, migration, route, or middleware was added. This is
context-integration only, per the task's explicit scope: COM-6B (resource
ownership/authorization) and COM-6C (immutable order snapshots) are
**not** implemented here.

19 focused tests (`CommerceCustomerContextIntegrationTest` — 14 original +
5 added for the P1 fix), all passing on first run on both SQLite and
PostgreSQL. Zero new full-suite failures on either engine, both before and
after the P1 fix; the pre-existing 27-failure baseline (`Fuel*Test` missing
`bcmath`, `DocumentCenterSecureIntakeTest` PDF-fixture gap) is unchanged
and verified identical by name on both engines at every stage.

## 2. Git

- **Base SHA:** `7b466c9b1b95a7a96bae94f9c7577ae1679046f3` (`origin/main`
  HEAD at task start — the tip commit is `CUS-COM-GATE-1 — Align Commerce
  with Shared Customer Platform (#744)`, confirming the gate is merged).
- **Branch:** `claude/commerce-customer-platform-context-2t4oj8`.
- **PR:** [#749](https://github.com/safwan5001-source/Nebrax/pull/749) —
  opened against `main`, not merged.
- **Head SHA (initial open):** `1714809`.
- **Head SHA (after P1 fix, current):** `b4ce26a`.

## 3. Binding sources read

1. `docs/plans/customers/CUS-ARCH-0-CUSTOMER-PLATFORM-ARCHITECTURE.md`
2. `docs/plans/customers/CUS-FOUNDATION-1-APPROVED-IMPLEMENTATION-DECISIONS.md`
3. `docs/plans/customers/PR-CUS-FOUNDATION-1-IMPLEMENTATION-REPORT.md`
4. `docs/plans/customers/CUS-COM-GATE-1-COMMERCE-INTEGRATION-GATE.md`
5. `docs/plans/store/AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md` (Phase 6,
   both the superseded original text and the CUS-COM-GATE-1 revision)
6. `docs/plans/store/PR-COM-5A-IMPLEMENTATION-REPORT.md`
7. `docs/plans/store/PR-COM-5B-IMPLEMENTATION-REPORT.md`

Plus direct inspection of the actual merged code (not assumed from the
plans): `App\Tenancy\CustomerContext`, `App\Http\Middleware\
{ResolveCustomerTenant,EnsureCustomerPrincipal,EstablishCustomerContext}`,
`App\Models\{CustomerIdentity,CustomerPartnerLink,CommerceOrder,
CommerceOrderLine}`, `App\Services\Commerce\{CommerceOrderService,
CommerceOrderReservationService}`, `App\Services\CustomerPartnerLinkService`,
`App\Support\CommerceBoundary`, `routes/api.php`, and the existing test
suites (`CommerceOrderServiceTest`, `CommerceOrderReservationServiceTest`,
`CommerceModuleBoundaryTest`, `CustomerDigitalAccessTest`,
`CustomerFoundationDatabaseInvariantTest`).

## 4. Inspection findings (before any change)

- **No Commerce HTTP route exists at all** — `grep -i commerce
  routes/api.php` returns nothing. `CommerceOrderService::create()`/
  `confirm()` and `CommerceOrderReservationService::reserve()` are pure
  internal domain services, called only by tests today. There is
  therefore no staff-facing or customer-facing Commerce *endpoint* to
  guard with middleware — confirmed both by direct route inspection and by
  `CUS-ARCH-0` §2.2 ("Commerce has no API route yet; its services are
  internal domain services" — still true post-merge).
- `CommerceOrderService::create(array $data, array $items)` is the **only**
  place in the entire Commerce codebase that accepts a caller-supplied
  `partner_id` (in `$data['partner_id']`). It validates the Partner exists
  in-tenant and stores it verbatim on the created `CommerceOrder` — this is
  exactly the "request-supplied ownership identifier" risk `CUS-ARCH-0`
  §10.2/§12 warns about, once a caller with less trust than today's
  internal/test callers reaches this method.
- `App\Tenancy\CustomerContext` is bound `scoped` in
  `TenancyServiceProvider` and exposes exactly `tenantId()`,
  `customerIdentityId()`, `linkedPartnerId()`, `hasPartnerLink()`,
  `isEstablished()` — matching `CUS-COM-GATE-1` §3/§7 verbatim. All getters
  throw `LogicException` if never established.
- `App\Http\Middleware\EstablishCustomerContext` is the **only** code path
  in the repository that ever calls `CustomerContext::set()`. It runs
  exclusively inside the customer route group
  (`/api/customer/v1/{tenantSlug}/...`), strictly after
  `ResolveCustomerTenant` + `auth:sanctum` + `EnsureCustomerPrincipal`. It
  rejects any non-`CustomerIdentity` principal (`abort(403)`), verifies the
  identity's tenant matches the active `TenantContext`, and resolves
  `linkedPartnerId` only through an active `CustomerPartnerLink` whose
  Partner is itself active and `customer|both` — then wraps the whole
  request in `try { ... } finally { $this->customerContext->forget(); }`.
  **No staff route, internal service call, or test that doesn't explicitly
  invoke this middleware can ever produce an established `CustomerContext`.**
- `EnsureUserPrincipal` (staff) and `EnsureCustomerPrincipal`/
  `EstablishCustomerContext` (customer) live on entirely separate route
  groups; `CustomerDigitalAccessTest` already proves the two-directional
  rejection (staff token → customer routes, customer token → staff
  routes) and was re-run unchanged and green (§7).
- Existing `CommerceOrderServiceTest` calls `create()` directly with a raw
  `partner_id` in several tests (e.g. `an_order_can_reference_an_optional_
  partner`) — this is exactly the "legitimate staff/internal flow" the task
  says to preserve, and it does not run inside any customer route group, so
  it never establishes `CustomerContext`.

## 5. Integration point chosen, and why it is the narrowest safe one

**Chosen integration point:** `App\Services\Commerce\CommerceOrderService::
create()` — specifically, how it derives the order's `partner_id`.

**Why not a new controller/route/middleware:** none exists yet for
Commerce to protect. Building one now would be speculative framework code
for a checkout API that is explicitly out of scope (`COM-7A`, not this
PR), and the task instructs against introducing abstractions the actual
code doesn't yet demonstrate a need for.

**Why not a new `customer_identity_id` column / ownership query scoping:**
that is `PR-COM-6B`'s explicitly stated job (`AWJ_COMMERCE_IMPLEMENTATION_
MASTER_PLAN.md` — "a `CommerceOrder`/Commerce resource query is scoped by
`customer_identity_id` derived from context"), and this task explicitly
forbids implementing COM-6B here. `create()` has no query to scope; it
only has one caller-supplied field (`partner_id`) that can currently be
used to falsely attribute an order to an existing Partner.

**Why this exact point is sufficient and narrowest:** `create()`'s
`partner_id` handling is the **only** place in the whole Commerce module
where request-shaped input can currently claim ownership-adjacent data
(a Partner reference) for a new record. Every other Commerce write
(`CommerceOrderLine` creation, `confirm()`, `CommerceOrderReservationService
::reserve()`) takes no customer/partner input at all. Fixing this one
input path, and doing so with a check (`CustomerContext::isEstablished()`)
that is `true` if-and-only-if the call happened inside the real customer
route group, closes the exact spoofing risk `CUS-ARCH-0`/`CUS-COM-GATE-1`
describe without touching anything COM-6B/6C own.

## 6. Direct `CustomerContext` consumption vs. an adapter

**Consumed directly — no Commerce-specific abstraction was introduced.**
`CommerceOrderService::create()` calls `app(CustomerContext::class)`
exactly as `EstablishCustomerContext`/`CustomerPartnerLinkService` already
do elsewhere in the codebase. Nothing in the actual code demonstrated a
need for a wrapper: Commerce needs exactly the four already-published
getters (`isEstablished()`, `tenantId()`, `hasPartnerLink()`,
`linkedPartnerId()`), it needs them at exactly one call site, and no
Commerce-specific transformation of their values is required. Per the
task's own instruction ("Create a Commerce-specific abstraction only if
actual code demonstrates a clear need"), none was built.

## 7. Behavior by state

### A. Guest

No `CustomerIdentity`/`CustomerContext` involved (guest requests never run
through `EstablishCustomerContext`, since it lives only on the
authenticated customer route sub-group). `resolveOrderPartnerId()` sees
`CustomerContext::isEstablished() === false` and falls through to the
**exact PR-COM-5A behavior**: `$data['partner_id']` is read and validated
in-tenant if present, `null` otherwise. Guest activity creates no
`CustomerIdentity`, no `Partner`, no `CustomerPartnerLink` — verified by
`guest_order_creation_invents_no_customer_identity_partner_or_link` and
`guest_order_creation_still_accepts_an_explicit_partner_id_unchanged_from_
com5a`.

### B. Authenticated customer — no Partner link

`CustomerContext::isEstablished() === true`,
`hasPartnerLink() === false` → `partner_id` is forced to `null`
regardless of any request input. No automatic Partner discovery or
creation is attempted. Verified by
`authenticated_unlinked_customer_resolves_the_correct_identity_and_a_null_
partner`.

### C. Authenticated customer — linked Partner

`CustomerContext::isEstablished() === true`, `hasPartnerLink() === true`
→ `partner_id` is taken **only** from `CustomerContext::linkedPartnerId()`.
The link itself is read-only from Commerce's perspective — `Commerce
OrderService` never creates, edits, or revokes a `CustomerPartnerLink`.
Verified by `authenticated_linked_customer_resolves_partner_only_from_
context` and `commerce_never_mutates_the_partner_link_as_a_side_effect_of_
ordering` (link status/partner_id byte-identical before/after order
creation).

## 8. Tenant behavior

`resolveOrderPartnerId()` adds one fail-closed defense-in-depth check:
when `CustomerContext` is established, its `tenantId()` must equal the
active `TenantContext` id, or a `RuntimeException` is thrown before any
row is written. In production this mismatch cannot currently occur
(`EstablishCustomerContext` always derives `CustomerContext` from the same
`TenantContext` it runs under, in the same `try/finally`-guarded request),
but the check is cheap, matches the task's explicit tenant-safety
requirement, and is exercised directly by
`a_customer_context_belonging_to_a_foreign_tenant_fails_closed` (which
constructs the mismatch deliberately, since no production code path can).

## 9. Principal separation

Unchanged and re-verified, not modified: `EnsureUserPrincipal` (staff) and
`EnsureCustomerPrincipal`/`EstablishCustomerContext` (customer) remain on
disjoint route groups; `CustomerDigitalAccessTest` re-run green (§13)
proves staff tokens are still rejected from customer routes and vice
versa. This PR additionally proves, at the point Commerce actually
integrates, that a staff `User` principal can never produce an established
`CustomerContext` for Commerce to consume:
`an_erp_staff_user_principal_is_rejected_by_establish_customer_context`
and `a_staff_principal_can_never_produce_an_established_customer_context_
for_commerce` drive the real `EstablishCustomerContext::handle()` with a
`User` principal and confirm both the `403` and that `CommerceOrderService
::create()` afterward behaves exactly as the guest/staff case.

## 10. Request spoofing protections

When `CustomerContext` is established, `$data['partner_id']` is **never
read at all** (not even as a fallback) — proven by
`a_spoofed_partner_id_cannot_override_an_established_unlinked_context` and
`a_spoofed_foreign_partner_id_cannot_override_an_established_linked_
context`. `$data['customer_identity_id']` and `$data['tenant_id']` were
never read by `create()` before this PR and remain unread —
`a_spoofed_customer_identity_id_in_the_payload_has_no_effect` and
`a_spoofed_tenant_id_in_the_payload_has_no_effect_on_the_active_tenant`
document this explicitly as regression coverage rather than leaving it
implicit.

## 11. Sequential-request isolation

`CustomerContext` is `scoped` (not `singleton`) and is explicitly
`forget()`-ed by `EstablishCustomerContext` both before establishing a new
value and in its `finally` block. `customer_context_does_not_leak_
between_sequential_order_creations` drives three consecutive order
creations in one test (linked identity A → guest → identity B) through the
real middleware and asserts no residual state crosses between them.

## 12. Changed files

**Modified (initial open):**
- `app/Services/Commerce/CommerceOrderService.php` — `create()`'s
  `partner_id` resolution now branches on `CustomerContext::isEstablished()`
  via a new private `resolveOrderPartnerId()`; `confirm()` and line
  creation are byte-for-byte unchanged.

**Modified (P1 fix, §21):**
- `app/Services/Commerce/CommerceOrderService.php` — `create()` gains an
  explicit `bool $trustedPartnerSelection = false` parameter;
  `resolveOrderPartnerId()` no longer reads `$data['partner_id']` at all
  in the contextless branch unless that flag is `true`.
- `tests/Feature/CommerceOrderServiceTest.php` — 6 existing COM-5A call
  sites that pass a raw `partner_id` (representing today's legitimate
  staff/internal selection) now pass `trustedPartnerSelection: true`
  explicitly.
- `tests/Feature/CommerceOrderReservationServiceTest.php` — 1 existing
  COM-5B call site (an alternate-UOM pricing test that needs a Partner's
  price list resolved) updated the same way.

**New:**
- `tests/Feature/CommerceCustomerContextIntegrationTest.php` — 14 focused
  tests at initial open (§13), +5 more for the P1 fix (§21) = 19 total.
- `docs/plans/store/PR-COM-6A-IMPLEMENTATION-REPORT.md` (this file).

No migration, no new model, no new route, no new middleware, no changes
to `setup.sh`/`.github/workflows/ci.yml`/`deploy/assemble.sh` (no new
top-level directory was introduced), at either stage.

## 13. Tests added and focused results (initial open)

`CommerceCustomerContextIntegrationTest` (14 tests) drives the real
`App\Http\Middleware\EstablishCustomerContext` (not a re-implementation)
to establish `CustomerContext` exactly as the merged customer route group
would, then calls `CommerceOrderService::create()` inside it:

1. `guest_order_creation_invents_no_customer_identity_partner_or_link`
2. `guest_order_creation_still_accepts_an_explicit_partner_id_unchanged_from_com5a`
   (superseded by the P1 fix — see §21; this test name/assertion no longer
   exists on the current head, replaced by
   `a_contextless_untrusted_caller_cannot_inject_a_partner_id_even_when_valid`)
3. `authenticated_unlinked_customer_resolves_the_correct_identity_and_a_null_partner`
4. `authenticated_linked_customer_resolves_partner_only_from_context`
5. `commerce_never_mutates_the_partner_link_as_a_side_effect_of_ordering`
6. `a_spoofed_partner_id_cannot_override_an_established_unlinked_context`
7. `a_spoofed_foreign_partner_id_cannot_override_an_established_linked_context`
8. `a_spoofed_customer_identity_id_in_the_payload_has_no_effect`
9. `a_spoofed_tenant_id_in_the_payload_has_no_effect_on_the_active_tenant`
10. `a_customer_context_belonging_to_a_foreign_tenant_fails_closed`
11. `an_erp_staff_user_principal_is_rejected_by_establish_customer_context`
12. `a_staff_principal_can_never_produce_an_established_customer_context_for_commerce`
13. `customer_context_does_not_leak_between_sequential_order_creations`
14. `order_creation_and_confirmation_remain_free_of_accounting_and_inventory_side_effects`

**SQLite:** 14/14 passed (35 assertions), first run, no fixes needed.

**PostgreSQL:** 14/14 passed (within a 102-test regression bundle, see
§14), first run.

## 14. Regression bundle results (initial open)

`CommerceCustomerContextIntegrationTest|CommerceOrderServiceTest|
CommerceOrderReservationServiceTest|CommerceModuleBoundaryTest|
CustomerDigitalAccessTest|CustomerFoundationDatabaseInvariantTest`:

- **SQLite:** 101 passed, 1 skipped (102 total; the skip is the
  PostgreSQL-only partial-index assertion in
  `CustomerFoundationDatabaseInvariantTest`, unrelated to this PR).
- **PostgreSQL:** 102 passed, 0 skipped.

Zero regressions in any COM-5A, COM-5B, or Customer Foundation test.

**Superseded by the P1 fix (§21):** the same bundle after the fix is
106/107 passed (SQLite/PostgreSQL) — one additional
`CommerceOrderReservationServiceTest` call site needed the explicit trust
flag once the implicit-trust gap was closed. See §21.7 for the current
numbers, which supersede the ones above.

## 15. Full-suite results (initial open — superseded, see §21.8)

| Engine | Passed | Failed | Skipped | Assertions |
|---|---|---|---|---|
| SQLite | 3162 | 27 | 15 | 20,655 |
| PostgreSQL | 3177 | 27 | 0 | 20,724 |

Both engines' 27 failures were verified **by name**, not just count, to be
identical to each other and to the pre-existing baseline documented in
every prior Commerce PR report (`PR-COM-5A` §42, `PR-COM-5B` §38/§45.9):
24 `Fuel*Test` cases (`FuelAviRfidServiceTest`, `FuelReconciliationTest`,
`FuelSaleApiTest`, `FuelSaleServiceTest`, `FuelSupplyReceivingApiTest`,
`FuelSupplyReceivingTest` — missing `bcmath` PHP extension in this
sandbox) plus `DocumentCenterSecureIntakeTest` (PDF-fixture gap). Zero new
failures, zero new failure categories, on either engine. The
PostgreSQL/SQLite passed-count difference (3177 vs. 3162 = 15) is exactly
the number of PostgreSQL-only concurrency/catalog tests that self-skip on
SQLite (unchanged by this PR).

## 16. CI

Not yet run as of either commit — CI triggers on PR push (`db: [sqlite,
pgsql]` matrix in `.github/workflows/ci.yml`). Local full-suite results
(§15, superseded by §21.8) were produced against a local PostgreSQL 16
instance configured identically to the CI service container
(`nibras`/`secret`/`nibras`), mirroring exactly what CI will run.

## 17. Discovered follow-up for COM-6B (not actioned here)

- `CommerceOrder` still has no `customer_identity_id` (or equivalently
  reviewed) ownership column — confirmed unchanged by this PR, exactly as
  `CUS-COM-GATE-1` §13 item 2 already flagged as an implementation-time
  decision for `COM-6A`/`6B`. This PR deliberately does not add it (see
  §5): there is no query yet to scope by it, and adding an unused column
  now would be schema speculation ahead of COM-6B's actual need.
- No Commerce HTTP route/controller exists yet for either staff or
  customer callers. COM-6B (and/or COM-7A, cart/checkout) will need to
  decide the first such route's middleware composition; this PR confirms
  there is nothing existing to migrate or protect today.
- `ContactController::update()`'s pre-existing ownership-validation gap
  (`CUS-ARCH-0` §3.5, `CUS-COM-GATE-1` §13 item 4) remains unrelated to
  Commerce and unactioned, as previously recorded.

## 18. Blockers / deviations

None. No contradiction was found between the approved architecture
(`CUS-ARCH-0`/`CUS-FOUNDATION-1`/`CUS-COM-GATE-1`) and the actual merged
code; the integration point and scope match the Master Plan's revised
Phase 6 (`PR-COM-6A`) text exactly.

## 19. Explicit confirmations

- **COM-6B (resource ownership & authorization) was NOT implemented.** No
  `customer_identity_id` column, no ownership-scoped query, no IDOR guard
  on any Commerce resource — none exists to guard yet, and none was added.
- **COM-6C (immutable order customer/contact/address snapshots) was NOT
  implemented.** No address/contact field, no snapshot logic, was added
  to `CommerceOrder`/`CommerceOrderLine`.
- **No accounting, inventory, ZATCA, payment, or POS semantics were
  changed.** `CommerceOrderService::confirm()`, `CommerceOrderLine`
  creation, `CommerceOrderReservationService`, `InventoryReservation`,
  `StockMovement`, average cost, the ledger, invoicing, ZATCA, and
  payments were not touched — verified directly by the unchanged,
  re-passing `CommerceOrderServiceTest`/`CommerceOrderReservationServiceTest`
  suites (§14) and by this PR's own
  `order_creation_and_confirmation_remain_free_of_accounting_and_inventory_
  side_effects` test asserting zero `JournalEntry`/`InventoryReservation`/
  `Invoice`/`Payment`/`StockMovement` rows after a full authenticated,
  linked-customer create+confirm cycle.

## 20. Accounting entries generated by this PR: NONE

Per `CLAUDE.md`'s mandatory pre-PR disclosure protocol: this PR introduces
**zero** new financial transactions and **zero** new journal entries.
`CommerceOrderService::create()`/`confirm()` remain exactly as
accounting-inert as PR-COM-5A/5B built them (ADR-01 §2/§6,
`App\Support\CommerceBoundary`) — this PR only changes *which* Partner
reference a Commerce order is allowed to carry, never any monetary/ledger
effect. There is no debit/credit table to present because no accounting
entry of any kind is produced by this change. Unchanged by the P1 fix
below.

## 21. P1 review finding — fixed on this PR/branch

### 21.1 The finding

The initial implementation (§7–§8 above) treated **every** call with no
established `CustomerContext` as equally trusted, falling through to
COM-5A's original behavior: read `$data['partner_id']`, check it exists
in-tenant, store it. That is correct for today's actual callers (tests
representing staff/internal selection — no Commerce HTTP route exists at
all yet), but unsafe as a *standing* rule: a future guest/public Commerce
path (COM-7A) would also never run through `EstablishCustomerContext`
(that middleware lives exclusively on the authenticated customer route
sub-group), so it would reach `create()` with **no** `CustomerContext`
either — indistinguishable, under the original logic, from a trusted
staff/internal caller. A contextless guest could therefore supply
`partner_id` and have it accepted after only an existence check, with no
Partner-ownership authority behind it at all.

### 21.2 Exact trust mechanism chosen

**An explicit, caller-set boolean parameter on `CommerceOrderService::
create()`: `bool $trustedPartnerSelection = false`.**

No new middleware, guard, permission, or authorization framework was
built — the task explicitly warned against expanding into COM-6B or
building broad authorization machinery, and none was needed. The fix is
entirely local to `resolveOrderPartnerId()`:

```php
private function resolveOrderPartnerId(string $tenantId, array $data, bool $trustedPartnerSelection): ?string
{
    $customerContext = app(CustomerContext::class);

    if ($customerContext->isEstablished()) {
        // unchanged — CustomerContext remains the sole authority,
        // regardless of $trustedPartnerSelection.
        ...
    }

    if (! $trustedPartnerSelection) {
        return null; // the untrusted default — $data['partner_id'] is never read.
    }

    // unchanged COM-5A behavior — the only remaining channel for it.
    $partnerId = $data['partner_id'] ?? null;
    ...
}
```

**Why this is the narrowest correct fix:**

- It closes the exact gap: "absence of `CustomerContext`" is no longer a
  usable signal of trust by itself. Trust must now be **stated**, not
  inferred from what's missing.
- It requires no new class, service, model, or route — the task's own
  instruction ("do not build a broad authorization framework", "do not
  implement COM-6B") ruled out a general trusted-caller registry, a
  request-attribute convention, or a new middleware layer, none of which
  the actual code demonstrates a need for today (there is still exactly
  one call site in the entire codebase that needs this — `create()`
  itself has no HTTP caller yet).
- It is impossible to satisfy accidentally: unlike inferring trust from
  request shape (e.g., "no Bearer token" or "no route parameter"), a
  boolean argument requires the calling code to explicitly opt in at the
  call site, which is exactly what "existing legitimate staff/internal
  Partner selection... ONLY through an explicitly trusted path" (the
  task's own wording) means in a codebase with no controller layer yet to
  carry a stronger signal (e.g., route middleware or an RBAC permission
  check). When a real staff-facing Commerce controller is eventually
  built (COM-6B territory), it becomes the one place responsible for
  deciding whether to pass `true` — today, that responsibility falls on
  each direct caller of the service, which is exactly the tests that
  represent it.
- `CustomerContext`, when established, is checked **first** and remains
  authoritative regardless of the flag — an authenticated customer caller
  can never use `trustedPartnerSelection: true` to smuggle a raw
  `partner_id` past their own linked/unlinked state (verified by
  `an_established_customer_context_overrides_the_trust_flag_entirely`,
  §21.4).

### 21.3 Behavior after the fix

| Caller shape | `CustomerContext` | `trustedPartnerSelection` | `partner_id` result |
|---|---|---|---|
| Guest / future public checkout | not established | `false` (default) | always `null` — `$data['partner_id']` never read |
| Explicitly trusted staff/internal call | not established | `true` | COM-5A behavior: validated in-tenant, stored if present |
| Authenticated customer, unlinked | established | irrelevant | `null` (unchanged from initial open) |
| Authenticated customer, linked | established | irrelevant | `CustomerContext::linkedPartnerId()` (unchanged) |

### 21.4 Tests added for the fix

Added to `tests/Feature/CommerceCustomerContextIntegrationTest.php`
(the vulnerable `guest_order_creation_still_accepts_an_explicit_partner_
id_unchanged_from_com5a` test was replaced, not merely supplemented, since
it had encoded the vulnerable behavior as the expected outcome):

1. `a_contextless_untrusted_caller_cannot_inject_a_partner_id_even_when_valid`
   — a real, existing Partner id in `$data['partner_id']` with no context
   and no trust flag still resolves to `null`.
2. `a_contextless_untrusted_caller_supplying_a_nonexistent_partner_id_is_
   not_validated_or_rejected` — proves the untrusted path does not even
   *read* `$data['partner_id']` (a garbage UUID causes no
   `RuntimeException`, unlike the old existence-check path).
3. `an_explicitly_trusted_caller_can_still_select_a_valid_partner` —
   `trustedPartnerSelection: true` with a valid Partner id still works
   exactly as COM-5A did.
4. `an_explicitly_trusted_caller_selecting_a_nonexistent_partner_is_still_
   rejected` — the trusted path still validates in-tenant existence
   (COM-5A's original guard, unchanged).
5. `untrusted_contextless_execution_cannot_impersonate_the_trusted_path` —
   the exact same payload as test 3, minus the flag, resolves to `null`;
   the flag alone is what distinguishes the two outcomes.
6. `an_established_customer_context_overrides_the_trust_flag_entirely` —
   an authenticated, unlinked customer passing both a foreign
   `partner_id` **and** `trustedPartnerSelection: true` still gets `null`
   — context wins unconditionally.

19 tests total in the file now (14 original + these 5, since one of the
14 was replaced rather than kept alongside its replacement).

### 21.5 Existing COM-5A/5B call sites updated

Three test files representing today's only "legitimate staff/internal"
callers were updated to pass `trustedPartnerSelection: true` explicitly,
since the fix removes their previously implicit trust:

- `tests/Feature/CommerceOrderServiceTest.php` — 6 call sites (Partner
  reference test, 4 COM-4A pricing-by-partner tests, 1 cross-tenant
  Partner rejection test).
- `tests/Feature/CommerceOrderReservationServiceTest.php` — 1 call site
  (`an_alternate_uom_factor_produces_the_correct_base_reservation`, which
  needs a Partner's price-list item resolved for an alternate UOM price).

No assertion in either file was weakened — each still proves exactly what
it proved before (a Partner reference lands on the order; cross-tenant
Partner references are still rejected; alternate-UOM pricing still
resolves correctly); only the explicit trust signal was added at the call
site, matching what the caller already represents.

### 21.6 Focused test results (P1 fix)

`CommerceCustomerContextIntegrationTest` (19 tests):

- **SQLite:** 19/19 passed (40 assertions), first run after the fix.
- **PostgreSQL:** 19/19 passed (40 assertions), first run after the fix.

### 21.7 Regression bundle results (P1 fix, supersedes §14)

`CommerceCustomerContextIntegrationTest|CommerceOrderServiceTest|
CommerceOrderReservationServiceTest|CommerceModuleBoundaryTest|
CustomerDigitalAccessTest|CustomerFoundationDatabaseInvariantTest`:

- **SQLite:** 106 passed, 1 skipped (107 total; the one skip is the same
  PostgreSQL-only partial-index assertion as before, unrelated to this
  PR).
- **PostgreSQL:** 107 passed, 0 skipped.

Zero regressions — every COM-5A/COM-5B/Customer Foundation assertion
still passes, now with the explicit trust flag at the 7 call sites that
needed it (§21.5).

### 21.8 Full-suite results (P1 fix, supersedes §15 — current truth)

| Engine | Passed | Failed | Skipped | Assertions |
|---|---|---|---|---|
| SQLite | 3167 | 27 | 15 | 20,660 |
| PostgreSQL | 3182 | 27 | 0 | 20,729 |

Both engines' 27 failures were re-verified **by name** after the fix,
identical to the pre-fix baseline (§15) and to every prior Commerce PR's
documented baseline — same 24 `Fuel*Test` cases (missing `bcmath`) plus
`DocumentCenterSecureIntakeTest` (PDF-fixture gap). The passed-count
increase versus §15 (3167 vs. 3162 on SQLite, 3182 vs. 3177 on PostgreSQL
— +5 on each) is exactly the net new focused tests added in §21.4. Zero
new failures, zero new failure categories, on either engine, before or
after the fix.

### 21.9 CI (P1 fix)

Not yet run as of the fix commit — CI triggers on push to this PR. Local
full-suite results (§21.8) were produced against the same local
PostgreSQL 16 instance configured identically to the CI service container,
mirroring exactly what CI's `db: [sqlite, pgsql]` matrix will run.

### 21.10 Confirmation

**The P1 finding is fixed.** A contextless caller (guest, or any future
public/checkout path that never establishes `CustomerContext`) can no
longer cause `partner_id` to become ownership authority under any
circumstance — the only remaining channel for a raw `partner_id` is an
explicit, caller-set `trustedPartnerSelection: true`, which no
untrusted/public request path can set on its own behalf. COM-6B and
COM-6C remain unimplemented; no accounting/inventory/ZATCA/payment/POS
semantics were touched by this fix.
