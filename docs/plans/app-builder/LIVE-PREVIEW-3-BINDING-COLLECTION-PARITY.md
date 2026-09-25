# LIVE-PREVIEW-3 — Binding + Collection Preview Parity

DATE: 2026-09-25
HORIZON: `AWJ_APP_BUILDER_LIVE_RUNTIME_PREVIEW_V1.md`
PREDECESSOR: LIVE-PREVIEW-2 — DONE / PASS (`LIVE-PREVIEW-2-PARITY-FOUNDATION.md`)
SCOPE: Owner-approved (Decision Gate resolved 2026-09-25, option 3) — see the horizon doc's
durable state for the full resolution text. Summary: Preview resolves `binding`/`collect`/
`itemProps`/`$item.*` against **clearly labeled representative/sample data**, never a live
fetch, no store-bearer token, no new backend endpoint.

## What was built

1. **`web/src/modules/app-builder/sample-resource-data.ts`** — sample `commerce.products` (3
   items) and `commerce.cart` (2 line items) data, field-for-field matching
   `app/Services/AppBuilder/DataResourceRegistry.php`'s real contracts (`price.amount_minor`/
   `currency`, `in_stock`, `category{id,name}` for products; `items[].unit_price`/`line_total`,
   `subtotal` for cart) — nothing invented, nothing renamed, so any `$item.<field>`/`itemProps`
   mapping a real schema declares resolves the same way here as it would against real data of
   the same shape.

2. **`web/src/modules/app-builder/canvas.tsx`** wired to LIVE-PREVIEW-2's
   `resolveNodeBindings` (`./runtime-contract.ts`):
   - `AppBuilderCanvas` now resolves the current page's root against
     `SAMPLE_RESOURCE_DATA` (`useMemo`) before rendering, so a `ProductList`/`CartList`/
     `ProductDetail`/`CartSummary` bound to `commerce.products`/`commerce.cart` — with or without
     `binding.collect`, with or without nested `$item.*` paths — now repeats its template and
     substitutes real (sample) values, exactly as the real runtime's `resolveNodeBindings` would.
   - A schema with **no** binding anywhere renders byte-for-byte as before LIVE-PREVIEW-3 (the
     `!binding` branch of `resolveNodeBindings` is a structural no-op pass-through) — zero visual
     regression for the overwhelming majority of drafts today.
   - **Sample-data labeling**: whenever the current page contains at least one `binding` node
     (checked on the *original*, pre-resolution tree via a new `hasAnyBinding` helper), a
     persistent banner renders at the top of the canvas — `t('sampleDataBanner')`, new i18n key
     in both `ar.json`/`en.json` — reading (Arabic) *"بيانات تجريبية — لإظهار شكل الربط
     بالبيانات فقط، وليست بيانات متجرك الفعلية"* / (English) *"Sample data — shows how data
     binding renders, not your real store data"*. This directly satisfies the owner's explicit
     "Preview must not imply that it is live" requirement — it is not a one-time toast a merchant
     can miss, it stays visible the whole time a bound page is open.
   - **Selection/editing correctness for repeated content**: `binding.collect` repetition
     produces synthetic node ids (`${templateId}-${itemId}`) that exist only in the *resolved*
     tree, never in the schema the Inspector edits. Clicking a repeated instance in Preview now
     maps to the nearest ancestor id that *does* exist in the original schema (`knownIds`/
     `selectFallbackId`, threaded through the existing recursive renderer) — concretely, the
     bound container (`ProductList`/`CartList`) itself, since the one-and-only template child is
     consumed and replaced by N instances and has no surviving distinct id to select. Before this
     task there was no repetition at all, so this concern didn't exist; without this fix, LP-3
     would have shipped a Preview where clicking inside any bound list silently failed to select
     anything meaningful in the Inspector.

## Owner-mandated guardrails — verified, not just asserted

- **Sample/representative data is not live merchant data**: `SAMPLE_RESOURCE_DATA` is a static,
  hardcoded module constant (no `fetch`, no `api()` call, no network — confirmed by reading the
  file: it has zero imports beyond nothing). It is committed source, identical for every tenant.
- **Preview must not imply live**: the persistent banner above, always visible while any bound
  content is on screen.
- **No store-bearer token minting/forwarding**: none added — `resolveNodeBindings` is a pure
  function; `canvas.tsx` only supplies its second argument from the local constant.
- **No new Sanctum/internal proxy endpoint**: no route added, no controller touched, no
  `routes/api.php` change in this task at all (confirmed: `git diff` for this task touches only
  `web/src/modules/app-builder/*` and `web/src/messages/*.json`).
- **No RBAC/Tenant Isolation/Commerce authorization/public API/schema-surface expansion**: same
  evidence — zero backend files changed, zero new permissions, zero new schema fields (LP-2
  already added `AppSchemaBinding.collect`; this task adds no field to the wire schema).
- **Real live product data in Builder Preview remains intentionally deferred** — this task does
  not attempt it, and nothing here forecloses a future, separately-scoped task doing so properly.
- **LIVE-PREVIEW-7 / exit criteria untouched**: this task changes only Preview's own rendering;
  it makes no claim anywhere (code, tests, or docs) that sample-data resolution is equivalent to
  proving live merchant-data parity, matching the note already recorded under LIVE-PREVIEW-7's
  own task section.

## Evidence

- **Focused**: `npx vitest run src/modules/app-builder` — 3 files / 32 tests passed
  (`runtime-contract.test.ts` 24, `sample-resource-data.test.ts` 3 new, `canvas.test.tsx` 5 new).
  `canvas.test.tsx` covers: unbound-schema regression (banner absent, unchanged rendering),
  no-collect `ProductList` binding (all 3 sample products render via `$item.name`/
  `$item.price.amount_minor`, banner present), `binding.collect` `CartList` (both sample cart
  items render via nested `$item.product_name`/`$item.line_total.amount_minor`), and the
  click-to-select fallback mapping (clicking a repeated instance selects the bound container's
  real schema id, not the synthetic instance id).
- **Relevant broader**: `npx vitest run src/modules/app-builder "src/app/(app)/app-builder"` —
  7 files / 73 tests passed, including the existing `builder/page.test.tsx` (27 tests, unaffected
  — confirms no regression in the Inspector/Layers/publish flow this canvas refactor could have
  broken).
- **Full suite**: `npm run test -- --run` — 298 files / 2111 tests passed.
- **Typecheck/build**: `npm run build` — clean.
- **CI**: web-only change (`git status` confirms only `web/src/**` touched) — only `web-ci.yml`
  runs; `mobile-ci.yml`/`ci.yml` (backend) are not triggered and need no re-verification.

## Decision Gate check

No Decision Gate applies. This task implements exactly the owner-approved scope from the
resolved LIVE-PREVIEW-3 gate — no live fetch, no auth change, no new API surface, no schema
change beyond what LP-2 already landed.

## Remaining gaps (carried forward)

- Real live `commerce.products`/`commerce.cart` data in Builder Preview — intentionally
  deferred, per the owner's decision, to a separately-scoped follow-up task.
- `visibility` evaluation and `action` dispatch/inert-vs-wired distinction in Preview — still not
  wired (LIVE-PREVIEW-4's job).
- Theme token key mismatch (`primaryColor` vs. `colorPrimary`) and Preview-during-editing
  compatibility gating — unchanged (LIVE-PREVIEW-4/5's job respectively).
- Draft/Default/Published preview-state disambiguation — unchanged (LIVE-PREVIEW-6's job).
- The Inspector's `binding.runtimeNote` copy remains stale for `commerce.products`/
  `commerce.cart` (flagged in LIVE-PREVIEW-1 §3/§8 row 10, not addressed by this task — it is
  Inspector copy, not Preview rendering, and out of this task's narrow scope).

## Next task readiness

**LIVE-PREVIEW-4 — Action + Theme + Supported Visibility Parity: READY.** LP-3 proves the
binding/collection half of Preview's semantic parity; LP-4 is the natural next step for the
remaining already-supported-but-unaligned semantics (action inert/wired distinction beyond what
LP-3 already touched only incidentally, visibility evaluation via the same `runtime-contract.ts`
module's already-built `evaluateVisibility`/`pruneInvisible`, and the theme token key
correction) — no new Decision Gate evidence found in this task that would block it.
