# MOBILE-RUNTIME-6 — Implementation Report

STATUS: done
DATE: 2026-09-23

## Outcome

The runtime now genuinely supports ar/en with RTL/LTR, not just an
Arabic-only RTL-fixed shell. `AwjMobileRuntimeApp` owns one `Locale`
above `MaterialApp`, driving `MaterialApp.locale`/`localizationsDelegates`/
`supportedLocales`, a locale-driven `Directionality`, and — via a new
app-bar toggle in `AwjRuntimeShell` — the whole tree flips language and
direction at runtime, no restart required. `CommerceClient` now sends
`Accept-Language` aligned with the already-accepted, already-implemented
server-side contract (`ADR-12-COMMERCE-API-LOCALE-RESOLUTION.md`,
`COM-MOBILE-I18N-1`). Product names follow the Commerce API's own
bilingual `name`/`name_en` pair — never a client-side re-translation of
business data. A new `RuntimeStrings` class holds this runtime's own UI
chrome text only. MR-11 accessibility proof (semantic labels via
`IconButton.tooltip`, a `SemanticsTester`-proxy VoiceOver/TalkBack smoke
path, large-text resilience, touch-target/focus sanity, no
direction-only meaning) is covered by six new widget tests in
`localization_test.dart`.

## Repository evidence / root cause

Continuation of the horizon, not a bug fix. Evidence read before starting:
- `docs/plans/mobile/AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md` §4 MR-10/MR-11
  (exact proof bullets this task must satisfy) and Gate E.
- `grep -rli "accept-language" docs/` found
  `ADR-12-COMMERCE-API-LOCALE-RESOLUTION.md` (Accepted, Owner Decision,
  2026-09-22) and `COM-MOBILE-I18N-1-IMPLEMENTATION-REPORT.md`: a
  server-side `Accept-Language` resolver already exists
  (`App\Support\CommerceLocale` + `App\Http\Middleware\ResolveCommerceLocale`),
  `ar`/`en` supported, `ar` default, shared across `/commerce/v1`/`/store/v1`,
  sets `Content-Language` on responses, and leaves the existing
  `name`/`name_en` product fields untouched. This shaped the entire
  approach: the mobile runtime's job is to *send* `Accept-Language` and
  *consume* the already-bilingual fields, never to invent its own
  translation layer for server-owned data.
- `mobile/lib/commerce/commerce_client.dart` read in full: confirmed the
  one `_send()` method already centralizes every outbound header, so
  adding `Accept-Language` needed exactly one new field + one new setter,
  no per-call-site change.
- `mobile/lib/registry/component_widgets.dart` read in full: confirmed
  `buildNavigationTarget`'s chevron was a hardcoded `Icons.chevron_left`
  (a direction-only glyph, violating MR-11's "no direction-only meaning"
  bullet) and `buildProductList` fixed its horizontal scroller's cross
  axis to a literal `height: 220` (a large-text-resilience risk — proven
  real by this task's own accessibility-scale test, see "Discovered
  backlog" below).

## Approach chosen

1. **Locale lives one level above `MaterialApp`.** `AwjMobileRuntimeApp`
   became a `StatefulWidget` holding `Locale _locale` (default `ar`, the
   project-wide RTL-first rule), because `MaterialApp.locale`/
   `localizationsDelegates`/`supportedLocales` and the app's own
   `Directionality` both need it above `MaterialApp`, not inside
   `AwjRuntimeShell` (which lives under `MaterialApp.home`). `_locale`
   flows down as a plain constructor parameter to `AwjRuntimeShell`,
   mirroring how `RuntimeState`/`CommerceClient` are already threaded —
   no new ambient/inherited mechanism invented for this task.
2. **One toggle, one source of truth.** `AwjRuntimeShell`'s app bar gained
   a `TextButton` (`key: 'locale-toggle'`) that calls
   `widget.onLocaleChanged` with the other language; the shell also calls
   `CommerceClient.setLocale()` on init and on every locale change
   (`didUpdateWidget`), so the Commerce API's resolved locale never drifts
   from what the UI shows.
3. **`RuntimeStrings` is scoped to UI chrome only, by design and by doc
   comment.** It covers this runtime's own static text (schema labels,
   screen chrome, status views) — never product/category names or server
   error messages. Product names use the new top-level
   `localizedProductName(name, nameEn, locale)` helper, which picks the
   Commerce API's own `name`/`name_en` field rather than translating
   anything; server error messages (`CommerceApiException.message`) are
   shown as-is, since `Accept-Language` already makes the server return
   them in the resolved locale (per `ADR-12`).
4. **`CommerceClient.setLocale(languageCode)`** sets a private
   `_acceptLanguage` field (default `'ar'`), sent as the `Accept-Language`
   header on every request via the existing centralized `_send()` method —
   no per-endpoint change, no new transport concept.
5. **Registry-layer components stay `Locale`-free; screens pre-translate
   into props instead.** `ComponentBuilder`'s signature
   (`(BuildContext, SchemaComponent, ActionDispatch)`) has no `Locale`
   parameter, and MOBILE-RUNTIME-3/4/5 never needed one. Rather than
   threading `Locale` through the whole registry API for two call sites,
   the locale-aware *screen* (which already has `widget.locale`) hydrates
   locale-aware strings into schema props before rendering:
   `buildCartSummary` now prefers an optional `summaryLabel` prop (falling
   back to its old hardcoded Arabic format if absent — no other caller
   breaks), and `buildQuantity`'s `_QuantityWidget` gained optional
   `decreaseLabel`/`increaseLabel` props threaded into each stepper
   `IconButton`'s `tooltip`. A new `withProp()` helper in
   `experience_hydration.dart` (alongside the existing `hydrateNode`)
   makes single-prop hydration a one-line call at each screen call site.
6. **Two real accessibility fixes, not just tests.** Building the required
   large-text-resilience test surfaced two genuine MR-11 gaps, both fixed
   in this task rather than deferred:
   - `buildNavigationTarget`'s trailing chevron now reads
     `Directionality.of(context)` and picks `chevron_left` (RTL) or
     `chevron_right` (LTR) — "forward" no longer has a fixed,
     direction-wrong meaning in one of the two supported directions.
   - `buildProductList`'s horizontal product scroller no longer fixes its
     cross axis to a literal `height: 220` (a `SizedBox` + `ListView`
     assuming two title lines + a price line fit under 220px at normal
     text scale). At an accessibility text scale (proven at 2.5×) each
     card's content genuinely overflowed that box. Replaced with a `Row`
     inside a horizontal `SingleChildScrollView`, which sizes to whatever
     height the tallest card's content actually needs at the active
     `MediaQuery` text scale — no magic constant to keep in sync with font
     metrics, and still a single unbounded-width scroller (this proof's
     product pages are small enough that `ListView`'s virtualization was
     never load-bearing).
7. **No new dependency except `flutter_localizations`** (a Flutter SDK
   package, not a pub.dev-versioned one — no MR-19 dependency review
   applies), needed for `GlobalMaterialLocalizations.delegate` etc.
   Transitively resolves `intl: 0.20.3`, already present.

## Why this approach fits AWJ

- MR-10's "no duplicated business translation authority" is structural,
  not just documented: `RuntimeStrings` literally cannot translate a
  product name — there is no method on it that takes one — and
  `localizedProductName` only ever selects between two fields the server
  already sends, never computes a new string.
- The `Accept-Language` contract reuses an already-accepted, already-live
  server decision (`ADR-12`) exactly as designed, rather than the mobile
  side inventing its own locale negotiation.
- Money stays integer minor units throughout — `formatMinorAmount` (from
  MOBILE-RUNTIME-3) is untouched; this task adds no new amount formatting
  path.
- Fail-safe/fail-closed carries through unchanged: an unset `decreaseLabel`/
  `increaseLabel`/`summaryLabel` prop falls back to the pre-existing
  hardcoded Arabic string, so a schema or caller that predates this task
  still renders exactly as before.
- Zero touch on `app/`, `database/`, `routes/`, or any PHP/Laravel code.

## Changed files

```
mobile/lib/app.dart                          (StatefulWidget; owns Locale; MaterialApp locale/delegates/supportedLocales; locale-driven Directionality)
mobile/lib/app/awj_runtime_shell.dart        (receives locale + onLocaleChanged; app-bar toggle; CommerceClient.setLocale wiring; passes locale to all 3 screens)
mobile/lib/app/cart_screen.dart              (RuntimeStrings for chrome/errors; locale-aware cart-go-home/quantity/remove/summary hydration)
mobile/lib/app/experience_hydration.dart     (new withProp() helper alongside hydrateNode)
mobile/lib/app/home_screen.dart              (RuntimeStrings for tagline/go-cart/errors; localizedProductName for card titles)
mobile/lib/app/product_screen.dart           (RuntimeStrings for chrome/errors; localizedProductName; locale-aware _PurchasePanel)
mobile/lib/app/runtime_strings.dart          (new — RuntimeStrings ar/en + localizedProductName)
mobile/lib/commerce/commerce_client.dart     (setLocale()/_acceptLanguage; Accept-Language header on every request)
mobile/lib/registry/component_widgets.dart   (direction-aware NavigationTarget chevron; buildCartSummary summaryLabel prop; buildQuantity decrease/increaseLabel props+tooltips; buildProductList height-safe rewrite)
mobile/pubspec.yaml                          (+ flutter_localizations SDK dependency)
mobile/pubspec.lock                          (regenerated by flutter pub get)
mobile/test/app/localization_test.dart       (new — 6 tests)
mobile/test/app/vertical_slice_test.dart     (updated — itemsCount text changed from old hardcoded format to RuntimeStrings' real Arabic plural forms)
mobile/test/commerce/commerce_client_test.dart  (+1 test — Accept-Language default + setLocale)
docs/plans/mobile/MOBILE-RUNTIME-6-IMPLEMENTATION-REPORT.md  (new, this file)
```

## Tests and exact results

```
$ flutter analyze
Analyzing mobile...
No issues found! (ran in 3.0s)

$ flutter test
...
00:05 +123: All tests passed!
```

123 tests total: 7 new (6 in `localization_test.dart` + 1 in
`commerce_client_test.dart`) on top of the 116 carried over from
MOBILE-RUNTIME-1–5 (1 existing assertion in `vertical_slice_test.dart`
updated to match `RuntimeStrings`' real Arabic plural text, not a new
test). All green, including:
- the app-bar toggle flips direction (`Directionality.of` RTL↔LTR), every
  chrome string (tagline, "go to cart"), and product card titles between
  the Commerce API's own `name` (`تمر`) and `name_en` (`Dates`) — and
  flips back to Arabic/RTL exactly on a second tap;
- toggling locale re-points `CommerceClient.setLocale`, proven by
  inspecting a `FakeCommerceTransport`'s recorded request headers before
  and after the toggle (`ar` → `en`);
- quantity stepper `IconButton`s expose locale-aware `Tooltip` widgets
  (the VoiceOver/TalkBack smoke proxy this environment has no real device
  to run) under the active locale's string;
- Home→Product→Cart render and navigate with zero layout/overflow
  exceptions at a 2.5× accessibility text scale (this test is what
  surfaced and proved the `buildProductList` fix above — it failed with a
  real `RenderFlex overflowed... on the bottom` before that fix);
- quantity `IconButton`s meet the Material 48×48 minimum touch target
  (`tester.getSize`) and accept keyboard focus (`Focus.of` on a descendant
  context, `requestFocus()`, `hasFocus` true) — focus/navigation sanity;
- the `NavigationTarget` chevron is `chevron_left` under Arabic/RTL and
  `chevron_right` under English/LTR, proving "forward" carries no
  direction-only meaning.
- `Accept-Language` defaults to `ar` on every request and follows
  `setLocale('en')`/`setLocale('ar')` exactly, verified against
  `FakeCommerceTransport`'s recorded headers.

## Build / lint / typecheck

`flutter analyze` (above, 0 issues). `dart format` run against every file
this task touched (0 changes — already formatter-clean). No native build
attempted — out of this task's scope (MOBILE-RUNTIME-9).

## CI

PR #958 opened on head `0eb982074045965e3d81dad0467b2a9652adf8df`; all 6
required checks (`mobile-ci.yml` analyze+test, `ci.yml` sqlite+pgsql, each
×2 for push+PR events) passed — `conclusion: success` on every run.

## Pre-merge review

- PRE_MERGE_REVIEW: **PASS**
- Reviewed Head SHA: `0eb982074045965e3d81dad0467b2a9652adf8df`
- Findings / resolution: fresh Reviewer + AWJ Guardian pass against the
  complete final diff (`git diff ace1cff 0eb9820`, 15 files, 1169
  insertions, 66 deletions):
  - All 6 required checks green on this exact head: `mobile (analyze +
    test)` ×2, `php artisan test (L11, sqlite)` ×2, `php artisan test
    (L11, pgsql)` ×2 — all `conclusion: success`. `mergeable_state: clean`.
  - Re-ran `flutter analyze && flutter test` directly against this exact
    head in this session: 0 analyze issues, 123/123 tests passing — not
    just trusting the CI badge.
  - Confirmed the diff touches only `mobile/` and this task's own report —
    no `app/`, `database/`, `routes/`, or other PHP/Laravel file anywhere
    in the diff (`git diff --name-only` checked explicitly).
  - Confirmed `CommerceClient.setLocale` only ever sets the
    `Accept-Language` header value from a closed `ar`/`en` toggle — it
    cannot reach `Authorization`/`X-Cart-Token`/`X-Customer-Token`, all
    still set exactly as MOBILE-RUNTIME-4 implemented them.
  - Confirmed `buildCartSummary`/`buildQuantity`'s new optional props
    (`summaryLabel`, `decreaseLabel`/`increaseLabel`) are backward
    compatible: each falls back to the prior hardcoded string, and no
    existing caller outside this task's own `cart_screen.dart`/
    `product_screen.dart` sets them.
  - Confirmed the `buildProductList` height fix does not regress the
    normal-text-scale case — the full 116-test carryover suite (including
    `vertical_slice_test.dart`'s end-to-end flow, which renders
    `ProductList` at default scale) still passes unchanged.
  - The one PR comment (`chatgpt-codex-connector[bot]` reporting it hit
    its own Codex usage limit) carries no review finding — no action
    needed. Zero human/bot reviews posted.
  - No accounting/tenant/RBAC/API/DB code touched.
  - No unresolved review finding or Decision Gate.

## Merge

- Merge status: **merged** (squash), PR #958.
- Merge SHA: `1dfce398a9efc1afccdb91b250015e2cf5c462d5`

## Post-merge review

- POST_MERGE_REVIEW: **PASS**
- Reviewed Merge SHA: `1dfce398a9efc1afccdb91b250015e2cf5c462d5`
- Target-branch checks/smoke:
  - `git fetch origin main` confirms `origin/main` tip is exactly this
    SHA, single parent `ace1cffb37b996bdbbba2c4b1b48f7d5e14bba26` — a
    genuine squash merge.
  - `git diff 0eb982074045965e3d81dad0467b2a9652adf8df origin/main --
    mobile/ docs/plans/mobile/MOBILE-RUNTIME-6-IMPLEMENTATION-REPORT.md`
    is empty — the squash preserved the reviewed content exactly.
  - Post-merge CI on this exact `head_sha`: `mobile-ci.yml` run
    [35839084209](https://github.com/safwan5001-source/Nebrax/actions/runs/35839084209)
    and `ci.yml` run
    [35839084178](https://github.com/safwan5001-source/Nebrax/actions/runs/35839084178),
    both `conclusion: success`.
  - Targeted post-merge smoke: `flutter analyze` (0 issues) and `flutter
    test` (123/123 passing) re-run directly against the merged content.
- Findings / resolution: none — no unexpected integration change.

**Flake observed and resolved during this task's own post-merge docs
follow-up (unrelated to the merged code):** the docs-only follow-up
commit recording this evidence (touching only this report file)
triggered a fresh `ci.yml` run whose `php artisan test (L11, sqlite)`
job failed once, on a single assertion in
`Tests\Feature\ZatcaQrCertificateMaterialExtractorTest` — a byte-string
mismatch on extracted EC public key material. Root-caused before
dismissing it: that test (pre-existing, untouched by this horizon)
generates a fresh random EC keypair via `openssl_pkey_new` with no fixed
seed in every run, so a leading-zero-byte edge case in the randomly
generated key's x/y coordinate can produce this exact mismatch on rare
runs. The identical PHP code had already passed this same test on the
merge SHA's own `ci.yml` run minutes earlier, and a one-time
`rerun_failed_jobs` on the docs commit's run reproduced clean (both jobs
`conclusion: success`) — confirming a genuine flake, not a regression
from this task's diff (which touches no PHP file). No code change was
made in response; recorded here per the horizon's CI-red protocol rather
than silently re-running without comment.

## Self-review

### Implementer
Did I satisfy MOBILE-RUNTIME-6's outcome and MR-10/MR-11's exact proof
bullets? MR-10: Arabic default ✓, English ✓, RTL/LTR ✓, `Accept-Language`
aligned with the existing Commerce API locale contract ✓ (reused `ADR-12`
exactly, invented nothing new), runtime/theme/layout direction-safe ✓
(chevron fix; Material widgets already handle RTL via ambient
`Directionality`), no duplicated business translation authority ✓
(`RuntimeStrings` structurally cannot translate business data). MR-11:
semantic labels for interactive controls ✓ (tooltips), VoiceOver/TalkBack
smoke path ✓ (documented `SemanticsTester`/`find.byTooltip` proxy, the
best available without a real device), large text resilience ✓ (proven
and fixed, not just asserted), touch target/focus sanity ✓ (48×48 +
keyboard focus proven), no direction-only meaning ✓ (chevron proven both
ways). Did I reuse existing authority instead of duplicating? Yes — the
server-side `Accept-Language` resolver and the `name`/`name_en` fields
both already existed; this task's only new business-adjacent code is the
one-line field-selection in `localizedProductName`.

### Reviewer
What would I reject if this PR came from another engineer? I specifically
checked: (1) that `RuntimeStrings` has no method that takes a product/
category name as input — confirmed by reading the whole file, not just
its doc comment; (2) that the `buildProductList` height fix doesn't
silently change spacing/behavior for the *normal*-text-scale case — the
full 116-test carryover suite (including `vertical_slice_test.dart`'s
end-to-end Home→Product→Cart flow, which renders `ProductList` at default
scale) still passes unchanged, so this wasn't validated only at the
accessibility scale; (3) that `buildCartSummary`/`buildQuantity`'s new
optional props are genuinely backward compatible — each has an explicit
fallback to the old hardcoded string, and I traced every existing caller
(`runtime_schema.dart`'s bundled `kCartSchemaJson` never sets these props
directly; only `cart_screen.dart`'s hydration does) to confirm none is
broken; (4) that `CommerceClient.setLocale` is called before any request
that matters — `AwjRuntimeShell.initState` calls it before either child
screen's first `initState`-triggered fetch, and `didUpdateWidget` handles
every later toggle, so no request is ever sent under a stale locale
header once the toggle exists. Is any code broader than the task? No
checkout/payment UI, no deep links, no push, no device-locale-follows-OS
behavior invented (MR-10 explicitly wants an in-app toggle, not just OS
following) — all still in scope for exactly this task.

### AWJ Guardian
Can Tenant A affect/read Tenant B? Not applicable — no tenant-selection
code in this diff; `Accept-Language` is a plain HTTP header carrying no
tenant identity. Is any financial value computed with unsafe types or
client authority? No — this task touches no amount/quantity arithmetic;
`formatMinorAmount` is untouched. Can authorization be bypassed? No —
`setLocale` only ever sets a header value string (`languageCode`, which
comes from a closed 2-item toggle, never free user input); it cannot
reach `Authorization`/`X-Cart-Token`/`X-Customer-Token`, which
`CommerceClient`'s existing MOBILE-RUNTIME-4 code still sets exactly as
before. Could a locally selected locale become business authority? No —
locale only affects display strings and the `Accept-Language` request
header for server-side text resolution (`ADR-12`); no price, stock, or
authorization decision anywhere reads `Locale`. Are secrets/PII exposed?
None — no token is read, logged, or displayed by this task's code.

## Accounting impact

None — no checkout/payment/order call exists anywhere in this horizon
yet; this task touches only display strings and an HTTP request header.

## Tenant / branch isolation impact

None — tenant/channel resolution remains entirely server-side via the
store bearer token (MOBILE-RUNTIME-4, untouched); `Accept-Language` is
orthogonal to tenant identity per `ADR-12`.

## Security / authorization impact

None negative. `Accept-Language` is a plain, closed-set (`ar`/`en`)
header value with no user-controlled free text reaching it; it cannot
widen or bypass any existing auth/session header
(`Authorization`/`X-Cart-Token`/`X-Customer-Token`), all of which remain
exactly as MOBILE-RUNTIME-4 implemented them.

## Backward compatibility

`AwjMobileRuntimeApp`'s public constructor (`client` param) is unchanged.
`AwjRuntimeShell` gained two new *required* constructor parameters
(`locale`, `onLocaleChanged`) — a breaking change to its own constructor,
but `AwjRuntimeShell` has exactly one call site in production code
(`app.dart`, updated by this task) and is not part of any public API
consumed outside this repository. `HomeScreen`/`ProductScreen`/
`CartScreen` similarly gained a required `locale` parameter, each with
exactly one call site (`awj_runtime_shell.dart`, updated by this task).
`buildCartSummary`/`buildQuantity`'s new props are additive and optional
with fallbacks — no existing caller breaks.

## API / DB / migration impact

None — this is mobile-side UI/localization code against an
already-existing, additively-extended `CommerceClient`; no server-side
file was touched (the `Accept-Language` contract it now sends was already
implemented server-side per `ADR-12`/`COM-MOBILE-I18N-1`, read but not
modified).

## External research used

None new — `ADR-12`/`COM-MOBILE-I18N-1` are existing accepted AWJ
decisions, read via `grep -rli "accept-language" docs/`, not external
research. Flutter APIs used (`flutter_localizations`,
`GlobalMaterialLocalizations`, `Directionality`, `IconButton.tooltip`,
`SemanticsTester`/`ensureSemantics`, `TextScaler`) are all stable,
long-standing framework APIs.

## Risks / remaining work

- `RuntimeStrings.itemsCount`'s Arabic plural forms (0/1/2/3–10/11+) are a
  simplified but genuine dual/plural split, not full ICU `MessageFormat`
  coverage — sufficient for this proof's one plural string, documented as
  such in the class's own doc comment.
- The app-bar locale toggle is this runtime's only locale entry point;
  there is no "follow device locale" behavior. This matches MR-10's own
  wording (an in-app ar/en toggle is the proof requirement) rather than
  an oversight, but a future task could add device-locale-as-initial-value
  if desired — out of this proof's scope.

## Discovered backlog

- `buildProductList`'s previous fixed `height: 220` was a latent
  large-text-resilience bug present since MOBILE-RUNTIME-3 (it predates
  this task) — found and fixed here specifically because MR-11 required
  an accessibility-scale test that MOBILE-RUNTIME-3/5 never had reason to
  write. Worth noting for `MOBILE-RUNTIME-10`'s final evidence pass: other
  fixed-dimension layouts introduced by later tasks should get the same
  scrutiny before horizon close.
- No RTL-specific snapshot/golden-image testing exists (visual mirroring
  of icons/paddings beyond the one chevron this task fixed) — this task's
  tests assert `Directionality`/rendered text/icon identity, not pixel
  layout; a golden-image RTL regression suite is a reasonable follow-up
  but is not what MR-11's stated proof bullets require.

## Continuation-mechanism follow-up

`subscribe_pr_activity` (event-driven) + `send_later` (fallback) again
worked reliably across this task's full PR lifecycle, including through
the CI-flake investigation on the post-merge docs follow-up (multiple
consecutive `send_later` check-ins correctly tracked two separate
`ci.yml` runs — the merge SHA's own and the docs-evidence commit's —
across a genuine ~15-19 minute `pgsql` job duration each time, with no
manual "continue" needed). No `ScheduleWakeup` use this task, per the
standing instruction.

## Git state

- Branch: `claude/awj-mobile-runtime-horizon-v1-g0n8mm`
- PR: #958 (merged)
- Base SHA: `ace1cffb37b996bdbbba2c4b1b48f7d5e14bba26` (`origin/main`, PR #957)
- Head SHA: `0eb982074045965e3d81dad0467b2a9652adf8df` (pushed, merged)
- Merge SHA: `1dfce398a9efc1afccdb91b250015e2cf5c462d5`

## Recommended next dependency-ready task

`MOBILE-RUNTIME-7` (Universal/App Links) — depends on MOBILE-RUNTIME-3 +
MOBILE-RUNTIME-5 per the horizon's dependency table, already satisfied;
does not require this task's own Post-Merge Review to start, though this
session continues sequentially. `MOBILE-RUNTIME-9` (Android/iOS
release-build proof) also becomes closer to dependency-ready once this
task and MOBILE-RUNTIME-7/8 merge.
