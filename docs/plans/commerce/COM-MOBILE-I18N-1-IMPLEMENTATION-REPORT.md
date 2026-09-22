# COM-MOBILE-I18N-1 — Implementation Report

## Outcome

A shared `Accept-Language` locale-resolution authority (RFC 9110 §12.5.4) for the entire public Commerce API surface, resolving `ADR-12`. Applied once, at the same outer middleware layer as `ForceJsonResponse`/`PublicApiRequestContext`, to both `/commerce/v1` and `/store/v1` — never a per-route or per-channel duplicate. Supports `ar`/`en`, defaults to `ar` when no supported preference is present. Purely additive: no existing route, resource, or response field changed shape; the one new observable effect is a standard `Content-Language` response header echoing the resolved locale.

## Repository evidence / root cause

Confirmed by exhaustive grep before implementation: no server-side locale resolution existed anywhere in `/commerce/v1` or `/store/v1` — bilingual fields (`name`/`name_en` and equivalents) already existed pervasively on business models, but the API always returned both raw, leaving the client to choose. `COMMERCE_MOBILE_API_READINESS.md` had already classified this "Ready with Hardening": the data was bilingual, the resolution mechanism was the gap.

## Approach chosen

1. **`App\Support\CommerceLocale`** — a pure, dependency-free static resolver: `SUPPORTED = ['ar', 'en']`, `DEFAULT = 'ar'`, and `resolve(?string $header): string` implementing RFC 9110 `Accept-Language` semantics (comma-separated language ranges, optional `;q=` quality values honored highest-first, primary-subtag matching so `en-US` matches `en`, a bare wildcard `*` never itself a match, case-insensitive, safe against a malformed `q` value). Kept as a pure function with no `Request`/`app()` dependency specifically so it is trivially unit-testable in isolation from any HTTP/middleware machinery.
2. **`App\Http\Middleware\ResolveCommerceLocale`** — calls `CommerceLocale::resolve()` against the request's `Accept-Language` header, sets it via `app()->setLocale()` for the request's lifetime only, and restores the previous locale in a `finally` block afterward — the same request-scoped-state discipline `EstablishCommerceCustomerContextIfPresent` already uses for `CustomerContext`, so a locale never leaks from one request into the next on a shared PHP worker. Also sets the standard `Content-Language` response header (RFC 9110 §12.5.5) to the resolved value — the one new, purely additive, externally-observable signal this task introduces.
3. **Wiring** — added to `CommerceApiServiceProvider::registerCommerceApiRoutes()` and `StorefrontApiServiceProvider::registerStorefrontApiRoutes()`'s existing outer `Route::middleware([...])` array, alongside `ForceJsonResponse`/`PublicApiRequestContext`. This is the one place both `/commerce/v1` and `/store/v1` already shared identical base middleware — adding the locale resolver here means every route on both surfaces gets it automatically, with no risk of a future new route group forgetting it (the failure mode duplicating it per-inner-group would have risked).

## Why this approach fits AWJ

- **Shared, not mobile-only**: the exact instruction this task was scoped under. The middleware is registered once per API surface's shared outer group, identically for `/commerce/v1` and `/store/v1` — no channel-specific locale logic exists anywhere.
- **Backward compatible by construction**: no existing resource's fields were touched. `name`/`name_en` pairs remain exactly as they were; this task only establishes the *authority* (`app()->getLocale()`) a resource may consult going forward, per the owner decision's explicit instruction not to force a rewrite of every existing contract in one pass.
- **Standards-based, not invented**: `Accept-Language`/`Content-Language` are both existing RFC 9110 HTTP semantics, not an AWJ-specific scheme — no external vendor research was needed, matching this task's own evidence packet finding that this item required no vendor/provider decision at all.

## Changed files

- `app/Support/CommerceLocale.php` (new)
- `app/Http/Middleware/ResolveCommerceLocale.php` (new)
- `app/Providers/CommerceApiServiceProvider.php` — `ResolveCommerceLocale` added to the shared route-registration middleware array; docblock updated
- `app/Providers/StorefrontApiServiceProvider.php` — same, plus docblock
- `tests/Feature/CommerceLocaleResolutionTest.php` (new, 15 tests)

No migration, no route added/removed, no existing resource's response shape changed.

## Tests and exact results

### `tests/Feature/CommerceLocaleResolutionTest.php` (15 tests / 36 assertions)

Four layers, deliberately separated:
1. **`CommerceLocale::resolve()` unit tests (9)** — missing/empty header, plain supported tag, regional-subtag matching, quality-value ordering (both directions), unsupported-preference fallback, an unsupported preference correctly skipped in favor of a later supported one, a bare wildcard never itself matching (with and without a supported tag also present), a malformed `q` value failing safely, case-insensitivity.
2. **Middleware isolation tests (2)** — the middleware resolves the correct locale for `$next()`, sets `Content-Language`, and restores the prior `app()->getLocale()` afterward; defaults to `ar` when the header is forced genuinely empty.
3. **Route-wiring assertions (2)** — `ResolveCommerceLocale::class` is actually present in `Route::getRoutes()`'s gathered middleware for a representative route on each of `/commerce/v1` and `/store/v1`, proving the wiring is live, not just that the class works in isolation.
4. **Real HTTP requests (2)** — a genuine `/commerce/v1` request and a genuine `/store/v1` request (through real domain resolution, `StorefrontDomain`/`Storefront`/`SalesChannel` seeded) each assert the `Content-Language` response header for both an explicit `en` preference and the `ar` default.

A testing-environment subtlety discovered and fixed during this task: Symfony's `Request::create()` (used both directly in unit tests and internally by Laravel's `getJson()` test helper) hardcodes its own `Accept-Language: en-us,en;q=0.5` default for any request that doesn't explicitly override the header — meaning "omit the header" in a test does **not** simulate a genuinely absent header; it silently resolves to `en` regardless of the real feature code's own default. Every "default/no-header" test case explicitly forces `Accept-Language` to an empty string to correctly exercise the `ar`-default path. This is a test-authoring subtlety, not a production behavior gap (a real client that sends no `Accept-Language` header at all produces an empty value at the PHP/webserver layer, which `CommerceLocale::resolve()` already handles as the empty-string case).

### Regression

- Full `Commerce|Customer|Storefront` regression: **961 passed on SQLite** (up 15 from `COM-MOBILE-ORDER-HISTORY-1`'s last count, matching this task's one new test file), **0 failed**; PostgreSQL regression run alongside, see PR for exact count.
- No existing test's assertions on response shape/fields were affected — the only new field introduced anywhere is the additive `Content-Language` response header.

## Self-review

### Implementer

The entire feature is two new, small, dependency-free classes plus a one-line addition to two already-existing middleware arrays. No new business logic touches any Commerce domain model, order, cart, or checkout code.

### Reviewer

Verified the middleware genuinely restores the prior locale (not just sets a new one) via a direct unit test capturing `app()->getLocale()` both during and after `handle()` runs. Verified the wiring is live (not just that the class compiles) via `Route::getRoutes()` reflection on both surfaces. Verified the RFC 9110 quality-value parsing handles the two directions (a low-quality supported tag losing to a high-quality one, and vice versa) plus the wildcard edge case explicitly, since these are the parts of the standard most likely to be gotten wrong.

### AWJ Guardian

- **Double-entry / money**: none — no financial write path in this task.
- **Tenant isolation**: unaffected — this middleware runs before/alongside `ResolveCommerceChannel`/`ResolveStorefrontDomain` and reads only the request's own `Accept-Language` header; it never reads or writes any tenant-scoped data.
- **Backward compatibility**: verified directly — the full `Commerce|Customer|Storefront` regression (961 tests) shows zero change to any existing response shape; the new `Content-Language` header is additive only.
- **Configurable policy vs. hardcoded**: the two supported locales and the default are owner-decided (`ADR-12`) constants in one place (`CommerceLocale::SUPPORTED`/`DEFAULT`), not scattered magic strings.

### Researcher/Architect

Confirms this closes the one item from the Commerce Mobile API Readiness Decision/Evidence Packet that needed no vendor/provider decision at all — the packet's own assessment is borne out by how small and self-contained the actual implementation turned out to be.

## Accounting impact

None. No journal entry, invoice, payment, or inventory movement is created, read, or affected by any code path in this task.

## Tenant / branch isolation impact

No new model. The middleware is stateless per-request and reads no tenant-scoped data; tenant isolation is entirely unaffected.

## Security / authorization impact

None — this middleware performs no authentication, authorization, or ownership check of any kind; it is a pure request-header-to-application-locale mapping.

## Backward compatibility

- No existing route, resource, or response field changed. `name`/`name_en` pairs remain exactly as they were on every existing resource.
- The new `Content-Language` response header is additive; no existing client parsing these responses is affected by an unrecognized extra header.
- Error-message localization was explicitly out of scope for this pass, per `ADR-12` §6 — no existing hardcoded Arabic error string was touched.

## API / DB / migration impact

No migration. No new route. Every `/commerce/v1` and `/store/v1` response gains one new, additive `Content-Language` response header.

## External research used

RFC 9110 §12.5.4 (`Accept-Language`) and §12.5.5 (`Content-Language`) — standard HTTP semantics, not vendor-specific; no external vendor/provider research was applicable to this task, consistent with the Decision/Evidence Packet's own finding.

## Automated review findings

Not yet opened for review — will be recorded here once PR review completes, per the standing merge policy.

## Risks / remaining work

- Error-message translation (converting the existing hardcoded Arabic error-string catalog to route through `app()->getLocale()`) remains explicitly incomplete, per `ADR-12` §6's own authorization to proceed incrementally. Any *new* error message from this point forward should route through this locale authority rather than adding another hardcoded string.

## Discovered backlog

- None beyond the incremental error-message-translation follow-up already named above and in `ADR-12` itself.

## Git state

Branch: `claude/com-mobile-i18n-1`, branched fresh off `main` post-owner-decision (ADR-09..13, PR #934). PR/commit/final-SHA details recorded once opened and merged.

## Recommended next dependency-ready task

`COM-MOBILE-SHIPPING-1` (`ADR-10`, configurable shipping zones/rates) or `COM-MOBILE-PAYMENTS-1` (`ADR-09`, Payment Intent + COD/Pay on Pickup) — both independently ready, neither depends on this task landing first.
