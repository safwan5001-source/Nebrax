# STORE-LOCALE-WIRING-1-SCOPE — Public Storefront Locale Wiring — Evidence Pass

**Status:** Evidence pass only. No implementation, no migrations, no Production changes.

## Status

Repository evidence pass complete. Root cause isolated to a single file
(`storefront/src/proxy.ts` + `storefront/src/lib/store.ts::getDefaultLocale()`
consumed by `storefront/src/lib/spree/middleware.ts`). No backend change is
required. STORE-ADMIN-ADOPT-1B-1's persistence/mutation code was not touched
and does not need to be.

## Confirmed Production Evidence

Per the ticket (ground truth, not re-verified here):

- STORE-ADMIN-ADOPT-1B-1 (PR #846) is merged and deployed.
- Storefront resolved by `alrshd.store.awjdev.xyz` has, in Production:
  `name = "ستور الرشد"`, `default_locale = "en"`, `is_active = true`.
- The ERP Store Settings mutation persisted `default_locale = en` successfully.
- Opening `https://alrshd.store.awjdev.xyz` still renders Arabic/RTL.
- Conclusion given: persistence works, Host → Storefront resolution works,
  the gap is purely in public storefront locale consumption/rendering.

This pass's job was to find exactly where that consumption breaks. It does.

## Current Public Storefront Locale Flow

Traced end to end, in call order for a **first, cookie-less visit** to
`https://alrshd.store.awjdev.xyz/` (the exact scenario in the Production
evidence):

1. **Host arrives** at the `storefront/` Next.js app (separate Vercel
   deployment from `web/`, per `CLAUDE.md`'s stack notes — this is the public
   buyer-facing app, not the ERP admin `web/` app).
2. **`storefront/src/proxy.ts`** is the Next.js Edge Middleware entry point.
   It builds `createSpreeMiddleware({ defaultCountry, defaultLocale,
   supportedLocales })` **once, at module load**, using
   `getDefaultLocale()` / `getDefaultCountry()` from `storefront/src/lib/store.ts`
   — both read `process.env.NEXT_PUBLIC_*` build/runtime env vars, not any
   per-request or per-tenant data.
3. **`storefront/src/lib/spree/middleware.ts`** (`createSpreeMiddleware`)
   runs on every request before any route/page code. For a bare `/` request
   with no `spree_locale` cookie and no matching `Accept-Language`, it
   computes:
   ```
   locale = cookieLocale ?? acceptedLocale ?? defaultLocale   // line 199
   ```
   and issues a **redirect** to `/{country}/{locale}` (line 200-206). This
   middleware is synchronous and has **zero network/API access** — it never
   calls the Laravel Store API, never resolves a `Storefront` row, and has
   no knowledge of `Storefront.default_locale`. `defaultLocale` here is the
   static value baked in step 2.
4. The browser follows the redirect to (in Production, since no
   `NEXT_PUBLIC_DEFAULT_LOCALE` override changes the code default) `/sa/ar/`.
5. **`storefront/src/app/[country]/[locale]/layout.tsx`** now renders with
   `locale = "ar"` from the URL segment. It does call
   `getMarkets()` → `staticAwjMarket()` → `resolveAwjDefaultLocale()`
   (`storefront/src/lib/data/markets.ts`), which **does** correctly call
   `fetchStorefrontDefaultLocale()` and would return `"en"` for this tenant.
   But that value is only used to populate `Market.default_locale` for
   catalog/currency purposes and as a **fallback target if the requested
   locale is not enabled for the Market** (`isLocaleEnabledForMarket`).
   Since `staticAwjMarket()` always sets `supported_locales: ["ar", "en"]`
   unconditionally (both are always "enabled"), `isLocaleEnabledForMarket`
   is always `true` for `ar`, so this corrective redirect **never fires**.
6. **`DocumentShell`** (`storefront/src/components/layout/DocumentShell.tsx`)
   sets `<html lang={locale} dir={localeDirection(locale)}>` purely from the
   already-decided URL `locale` param. This layer is correct and faithful —
   it just never receives `"en"` for this tenant because step 3 never asked.

Net result: the value that reaches `<html lang>`/`dir` and the loaded
message bundle is **whatever the redirect middleware picked**, and the
redirect middleware never consults `Storefront.default_locale`. The value
Production correctly fetches and stores (`Storefront.default_locale = en`)
is used only for currency/Market metadata downstream, and for a locale
"fallback correction" path that is architecturally dead code today because
both locales are always advertised as enabled.

## API Contract Evidence

**Q1: Does `GET /api/store/v1/storefront` currently return `default_locale`?**

Yes. `app/Http/Controllers/Api/StorefrontConfigController.php::show()`:

```php
$row = Storefront::query()->whereKey($context->storefrontId())
    ->first(['name', 'default_locale']);
...
return new JsonResponse(['data' => ['name' => $name, 'default_locale' => $defaultLocale], ...]);
```

This is exercised in `tests/Feature/StorefrontPublicIdentityTest.php`
(asserts `default_locale === 'ar'` for a configured Storefront, and
`null` on the legacy tenant-slug path with no `Storefront` row).

Note: the separate mobile-facing `app/Http/Controllers/Api/CommerceStorefrontController.php`
(`/commerce/v1`) intentionally does **not** return `default_locale` — its own
docblock explains the mobile path never resolves a `Storefront` row
(`MobileSalesChannelResolver`), so there is no source to report. That
controller is out of this ticket's scope (public web storefront only) and
is evidence the project already treats "no field until there's a real
source" as the house style — worth following for any new field this
ticket's fix might add.

## Frontend Locale Evidence

**Q2: Does the storefront frontend fetch and preserve that value?**

Yes, partially — it fetches it but only wires it into currency/Market
metadata, not into the routing decision:

- `storefront/src/lib/commerce/storefront.ts::fetchStorefrontConfig()` /
  `fetchStorefrontDefaultLocale()` call `GET storefront` and return
  `default_locale` (falls back to `null` cleanly, never invents a value).
- `storefront/src/lib/data/markets.ts::resolveAwjDefaultLocale()` calls
  `fetchStorefrontDefaultLocale()`, resolves it against
  `SUPPORTED_LOCALES`, and falls back to `DEFAULT_LOCALE` (`"ar"`) on any
  error — deliberately, per its own comment citing
  `AWJ_COM_7_P2_STOREFRONT_DOMAIN_RESOLUTION_DECISION.md §9`
  ("Arabic is always a safe fallback").
- This value lands on `Market.default_locale`, consumed only by
  `storefront/src/app/[country]/[locale]/layout.tsx` for the **already
  resolved** `/{country}/{locale}` route — never by the middleware that
  decides which `{locale}` segment a bare `/` request is redirected to.

**Q3: What currently determines public storefront language?**

Not hard-coded Arabic strings, and not (for the routing decision) fetched
`Storefront.default_locale`. Precisely, for the very first render of `/`:
a single process-wide env var, `NEXT_PUBLIC_DEFAULT_LOCALE`
(`storefront/src/lib/store.ts::getDefaultLocale()`, default `"ar"` in
code), consumed once at middleware construction
(`storefront/src/proxy.ts`). For subsequent navigation within an existing
`/{country}/{locale}` prefix, or after the buyer uses the language
switcher, the `spree_locale` cookie takes over (`middleware.ts` lines
132-178, `RegionPreferences.tsx` UI). `Accept-Language` negotiation sits
between the cookie and the env default in precedence (line 199), so a
browser sending `Accept-Language: en` would also produce English —
independent of `Storefront.default_locale` too.

**Q4: What determines `<html lang>` and `dir="rtl|ltr"`?**

The `locale` route param alone: `DocumentShell` calls
`localeDirection(locale)` (`storefront/src/i18n/locales.ts`), which is a
static `RTL_LANGUAGES` set lookup (`ar`, `fa`, `he`, `ur`, `yi`). This layer
is correct and needs no change — it already does exactly what the language
decision doc requires, for whatever locale it's given.

## Translation Resource Evidence

**Q5: Are public storefront strings already localized?**

Yes — already localized, not a gap. `storefront/messages/{ar,en,de,es,fr,pl}.json`
exist, `ar.json` and `en.json` both have 692 top-level keys (parity), loaded
via `next-intl` (`loadMessages()` in `storefront/src/i18n/locales.ts`, wired
through `NextIntlClientProvider` in the `[country]/[locale]/layout.tsx`).
No Arabic or English hard-coded UI strings were found outside these message
bundles in the traced flow (nav, home page, layout, metadata). Classification:
**already localized** for the entire path this ticket touches. This means
the fix has **no translation-completion component**.

## lang / dir Evidence

Covered under Q4 above — `localeDirection()` / `DocumentShell` is correct
and is not part of the root cause. Included here for completeness per the
report template: the RTL language set is a static allow-list (`ar`, `fa`,
`he`, `ur`, `yi`), so any future locale added to `SUPPORTED_LOCALES` gets
correct `dir` automatically.

## Existing Language Decision / Documentation

`docs/plans/store/AWJ_STORE_LANGUAGE_DECISION.md` (approved decision,
2026-09-10) directly answers Q6 and Q7:

- **§Rule 1**: Arabic is the store's primary language.
- **§Rule 4**: *"اللغة الافتراضية للمتجر تأتي من إعدادات المتجر/أَوْج، مع
  إمكانية تمكين الزائر من تغيير اللغة وفق إعدادات المتجر"* — i.e.
  `default_locale` is explicitly documented as an **initial/default**
  language, not a permanently forced one, and a buyer-facing language
  switcher is explicitly anticipated (subject to store settings) — this
  directly answers Q6.
- **§Architectural principle**: *"أَوْج هو مصدر الحقيقة لإعدادات لغة
  المتجر"* — AWJ (the ERP `Storefront.default_locale`) is the source of
  truth; the storefront **consumes**, never creates a parallel/conflicting
  locale-settings source.
- **§Out of scope today**: URL structure for multiple languages is
  explicitly listed as *not yet settled* by this decision doc — relevant to
  Q8/routing-change risk below.

**Q7: Does an existing customer-facing language switcher or locale
cookie/query/path contract already exist?**

Yes — do not invent one. `storefront/src/components/layout/RegionPreferences.tsx`
is a working buyer-facing language/country switcher (`useCountrySwitch`
hook), it writes the `spree_locale` / `spree_country` cookies the middleware
already reads with top precedence over `Accept-Language` and the env
default. This is the "explicit buyer preference" layer the decision doc
anticipates. **No new switcher, cookie, or query contract is needed.**

## Root Cause

`storefront/src/proxy.ts` builds the locale-redirect middleware with a
**static, process-wide** `defaultLocale` sourced from
`storefront/src/lib/store.ts::getDefaultLocale()`
(`process.env.NEXT_PUBLIC_DEFAULT_LOCALE`, code fallback `"ar"`). This
middleware runs on every request, before any per-tenant data is resolved,
and is what decides the `{locale}` segment a first-time, cookie-less
visitor to `/` is redirected into
(`storefront/src/lib/spree/middleware.ts` line 199-206). Since this
storefront deployment serves **multiple tenants by Host** (the whole point
of `Storefront`/`StorefrontDomain` resolution), a single process-wide env
var cannot represent every tenant's `default_locale` — and today it isn't
even tried: the middleware never calls the Store API.

`Storefront.default_locale` **is** correctly fetched later
(`resolveAwjDefaultLocale()` in `storefront/src/lib/data/markets.ts`), but
only for `Market.default_locale` (currency/catalog metadata) and a
locale-fallback-redirect path inside `[country]/[locale]/layout.tsx` that
is currently unreachable in practice, because `staticAwjMarket()`
hard-codes `supported_locales: ["ar", "en"]` for every tenant, so
`isLocaleEnabledForMarket` never rejects a requested locale and the
correction never triggers.

In short: **the API contract and the fetch-side plumbing already exist and
already work; the piece that never asks the question is the Edge
middleware that owns the very first redirect.**

## Security / Tenant Isolation Impact

None identified against the *current* code, and the recommended slice
below preserves the boundary:

- `ResolveStorefrontDomain` / `StorefrontContext` were not modified and
  evidence did not surface a reason to touch them — Host → `StorefrontDomain`
  → `Storefront` → `Tenant`/`SalesChannel` remains the sole resolution path
  in `app/Http/Middleware/ResolveStorefrontDomain.php` and
  `app/Tenancy/StorefrontContext.php`.
- The `GET /api/store/v1/storefront` endpoint used to read `default_locale`
  is public, read-only, and already scoped by the resolved
  `StorefrontContext` — it is not a new attack surface, it's the same
  endpoint `name` already comes from.
- Locale is, and must remain, a **display preference derived from** the
  server-resolved `Storefront`, never an input that selects or influences
  which tenant/storefront is resolved. Nothing in the traced flow accepts
  `tenant_id`/`storefront_id` from the browser; `default_locale` flows
  one-directioniy from the already-resolved context to the UI.
- If the eventual fix makes the Edge middleware call the Store API to
  learn `default_locale` before redirecting, that call must go through the
  **same** Host-forwarding contract `storefront/src/lib/commerce/config.ts`
  already uses (`X-Storefront-Forwarded-Host`) — not a new trust path — and
  must fail closed (fall back to the existing static default) on any
  resolution failure, exactly as `resolveAwjDefaultLocale()` already does
  for the downstream Market call. This is evidence for the "smallest
  slice" recommendation below, not a change made in this pass.

## Backward Compatibility

- Existing stores whose `Storefront.default_locale = "ar"` (the DB column
  default per `database/migrations/2026_09_20_010000_create_storefronts_table.php`
  — `->default('ar')` — and the `Storefront` model's `$attributes` default)
  see **no behavior change** under any fix that makes the middleware honor
  `default_locale`: today's static fallback already resolves to `"ar"`.
- A buyer's existing `spree_locale` cookie or explicit path segment
  (`/sa/en/...`) must keep taking precedence over `Storefront.default_locale`
  — this is the existing, documented (§Rule 4) precedence and the
  recommended fix does not touch cookie/path precedence, only what backs
  the *env-var* fallback level.
- No public URL shape changes: `/{country}/{locale}/...` stays exactly as
  is; only which `{locale}` a bare `/` redirects into for a fresh visitor
  changes, and only for tenants whose `default_locale` differs from `ar`.

## Candidate Fixes Considered

1. **Have the Edge middleware fetch `Storefront.default_locale` per-request
   before redirecting a bare `/`.** Smallest conceptual change, but adds a
   network round-trip (Host-forwarded API call) to the Edge middleware on
   every cookie-less/no-Accept-Language first hit, and needs its own
   caching/fail-closed story so an API outage doesn't strand new visitors.
   Not free, but additive and contained to `proxy.ts` / `middleware.ts`.
2. **Fix `isLocaleEnabledForMarket`/`staticAwjMarket()` so the market
   "supported locales" reflects only `[Storefront.default_locale]` (or a
   real per-tenant list) instead of always `["ar", "en"]`, letting the
   *existing* downstream correction in `[country]/[locale]/layout.tsx` do
   the redirect.** This reuses an existing, already-tested redirect path
   (`getDefaultMarketLocaleTarget` / `redirectToLocalizedRoute`) instead of
   adding a new one, but it would force a **second redirect hop**
   (`/` → `/sa/ar` (wrong) → `/sa/en` (corrected)) rather than fixing it in
   one hop, and it conflates "locales enabled for the market" with "which
   one is default" — the ticket only asks to fix default selection, not to
   restrict which locales a buyer may switch into. Rejected as not the
   smallest slice; also touches `i18n/markets.ts` logic used elsewhere.
3. **Move the storefront-language lookup out of Edge middleware into the
   `[country]/[locale]/layout.tsx` server component entirely, and have
   `proxy.ts` redirect bare `/` to a locale-less canonical path that the
   layout then resolves.** Larger routing-architecture change, not
   justified by this ticket's evidence — rejected as scope creep.

## Recommended Smallest Slice

**Option 1** is the smallest architecture-consistent fix: make
`storefront/src/proxy.ts`'s bare-`/` redirect path consult
`Storefront.default_locale` (via the existing `fetchStorefrontConfig()` /
Host-forwarding contract) as an additional precedence level, positioned
**below** the buyer's own cookie/path choice and **at or above** the
static env fallback — i.e.:

```
explicit path segment (existing)
  > spree_locale cookie (existing, buyer's own past choice)
  > Storefront.default_locale (NEW — resolved for this Host)
  > Accept-Language negotiation (existing)
  > NEXT_PUBLIC_DEFAULT_LOCALE / "ar" (existing, final fail-closed fallback)
```

This ordering is the only one consistent with both the confirmed
Production evidence (persisted `default_locale` should govern first
render) and the documented precedence in
`AWJ_STORE_LANGUAGE_DECISION.md` §Rule 4 (buyer can override the store's
default). It is *not* explicitly specified by that decision doc where
`Accept-Language` sits relative to `Storefront.default_locale` — this pass
recommends `Storefront.default_locale` outrank browser language, since the
ticket's own framing ("Storefront.default_locale should govern what
renders") and the decision doc's "أَوْج هو مصدر الحقيقة" architectural
principle both point that way; **this one ordering choice should be
confirmed with the product owner before implementation**, since it is a
policy call, not a technical one, per `CLAUDE.md`'s configurable-policy
rule (adapted here to the storefront's own decision doc rather than
`Settings`/`BranchSettings`, since AWJ Store's language policy already has
its own approved decision file).

## Exact Files Expected To Change

Implementation-time (not changed in this pass):

- `storefront/src/proxy.ts` — pass a per-request Storefront-locale resolver
  (or a resolved value) into `createSpreeMiddleware`, instead of only the
  static `getDefaultLocale()`.
- `storefront/src/lib/spree/middleware.ts` — accept and apply the
  Storefront-resolved default at the correct precedence level (line
  ~189-199), with a safe/cached fail-closed path.
- Possibly a small new helper alongside
  `storefront/src/lib/commerce/storefront.ts` (or reuse
  `fetchStorefrontDefaultLocale()`) callable from Edge middleware context —
  needs verification that `storefrontFetch`/`config.ts`'s `headers()` calls
  are Edge-middleware-safe (they currently run in Server Component/Route
  Handler context; Edge Middleware receives `NextRequest` directly, which
  is a compatible but distinct API — this needs a short spike, not covered
  by this evidence pass).
- `storefront/src/lib/spree/middleware.test.ts` — extend.

No backend (`app/`, `routes/api.php`) changes expected — the API contract
already exists and already returns the correct value.

## Required Test Matrix

Minimum tests to prove correctness, with exact existing files to extend:

1. **AR Storefront → Arabic/RTL (first visit, no cookie).**
   Extend `storefront/src/lib/spree/middleware.test.ts` (new case
   alongside existing `"falls back to a supported locale when the
   configured default is unavailable"` at line 34) — bare `/` with a
   resolved-Storefront-locale of `"ar"` and no cookie/Accept-Language
   redirects to `/{country}/ar`.
2. **EN Storefront → English/LTR (first visit, no cookie).** Same file —
   mirror case with resolved Storefront locale `"en"`, asserting redirect
   to `/{country}/en`. This is the exact scenario from the Production
   evidence and is the test that currently would fail without the fix
   (today it always resolves to the static default regardless of any
   per-tenant value).
3. **Correct Storefront selected by Host.** Already covered by existing
   backend tests — `tests/Feature/StorefrontPublicIdentityTest.php` and
   `tests/Feature/StorefrontGatewayAndConfigTest.php` already assert Host
   → Storefront resolution and `default_locale` payload; no new backend
   test needed unless the middleware's new fetch call needs its own
   integration coverage of the forwarded-host header contract (extend
   `storefront/src/lib/commerce/__tests__/storefront.test.ts` if a new
   Edge-safe fetch path is added there).
4. **Locale cannot cause cross-tenant bleed.** Add a middleware test
   asserting the locale resolution call is scoped to the request's own
   Host (mirrors the existing Host-forwarding contract tests in
   `storefront/src/lib/commerce/__tests__/storefront.test.ts` — extend,
   don't duplicate).
5. **Unknown/unresolved Host still fails closed at the API boundary.**
   Already covered server-side: `StorefrontConfigController` returns
   `default_locale: null` when no `Storefront` resolves (legacy path) —
   see `tests/Feature/StorefrontPublicIdentityTest.php` line 107. Add a
   middleware-side case that a failed/`null` Storefront-locale lookup
   falls through to the existing `Accept-Language` → env-default chain
   rather than erroring or hanging.
6. **Existing Arabic stores remain backward compatible.** Same new test
   block in `middleware.test.ts`: Storefront locale `"ar"` (or lookup
   failure) with no cookie/Accept-Language still redirects to `/{country}/ar`
   — must be a no-op vs. current behavior.
7. **Buyer locale override still wins.** Extend `middleware.test.ts`'s
   existing cookie-precedence coverage (implicit in the "canonicalizes an
   existing country and locale prefix" and cookie-sync tests) with a case
   where `spree_locale` cookie is `"en"` and resolved Storefront default is
   `"ar"` (or vice versa) — cookie must win, per §Rule 4 and this report's
   recommended precedence.
8. Existing `storefront/src/lib/data/__tests__/markets.test.ts` coverage of
   `resolveAwjDefaultLocale()` / `fetchStorefrontDefaultLocale` mocking
   error/success cases stays valid and does not need to change — it is a
   separate, already-correct consumer of the same API field.

## Explicit Exclusions

Per ticket scope, none of the following were inspected or are touched by
the recommended slice: Store provisioning, Store Identity mutation, Tenant
provisioning, SalesChannel lifecycle, StorefrontDomain verification,
custom domains, Product Publication, Cart, Checkout, Orders, Payments,
Shipping, inventory, accounting, branding/theme/appearance, SEO, App
Builder, multi-store creation. `ResolveStorefrontDomain` was read only to
confirm it needs no change — it is not modified.

## Risks

- **Edge Middleware network call latency/availability.** Adding an
  API fetch to Edge Middleware (Option 1) adds latency and a new failure
  mode to every cookie-less first request. Needs a short cache (e.g. an
  Edge-compatible cache keyed by Host, short TTL) and a fail-closed
  fallback to the current static default — mirroring
  `resolveAwjDefaultLocale()`'s existing try/catch pattern. This is a
  design detail for implementation, not resolved by this evidence pass.
- **Edge Middleware runtime compatibility.** `storefront/src/lib/commerce/config.ts`'s
  `resolveVisitorHostname()` currently uses Next.js's `headers()` Server
  Component API, not the `NextRequest` object Edge Middleware receives.
  The implementation will need a middleware-native way to read the Host
  header and call the Store API (or forward it) — a small compatibility
  spike, not a redesign.
- **Precedence-ordering is a policy call**, not purely technical (see
  Recommended Smallest Slice) — flagged for confirmation before
  implementation, consistent with `CLAUDE.md`'s "عند الشكّ في التصنيف: اعرض
  القرار على المالك قبل التنفيذ" rule.
- **`staticAwjMarket()`'s hard-coded `supported_locales: ["ar","en"]`**
  is a pre-existing simplification (single static AWJ Market, no real
  per-tenant locale restriction) that this ticket's fix does not change
  and does not need to change — noted only because it is why Candidate
  Fix 2 was rejected, not because it is itself broken for this ticket's
  scope.

## Decision

**READY_FOR_IMPLEMENTATION**

The gap is a single, well-isolated wiring omission (Edge Middleware never
asks the Store API for the resolved Storefront's `default_locale`) with an
already-complete API contract, already-complete translations, and an
already-correct `lang`/`dir` layer downstream. No translation foundation,
no routing redesign, and no product decision is needed on the *existence*
of the feature — only the exact `Storefront.default_locale` vs.
`Accept-Language` precedence ordering should be confirmed with the product
owner before writing code (see Recommended Smallest Slice), which does not
block scoping or estimating the slice itself.

**Exactly one smallest implementation slice:** teach
`storefront/src/proxy.ts` / `storefront/src/lib/spree/middleware.ts` to
resolve the current Host's `Storefront.default_locale` (via the existing
`GET /api/store/v1/storefront` contract and Host-forwarding mechanism,
cached and fail-closed) and use it as the redirect target for a
cookie-less bare `/` visit, at the precedence level described above. Do
not bundle: the `staticAwjMarket()` supported-locales simplification, any
new UI for the language switcher (one already exists), any translation
work (none needed), or any backend API change (none needed).

## Git

- **Branch:** `docs/store-locale-wiring-1-scope`
- **Base SHA:** `69707de3` (latest `origin/main` at evidence-pass start)
- **Head SHA:** filled in after commit (see PR)
