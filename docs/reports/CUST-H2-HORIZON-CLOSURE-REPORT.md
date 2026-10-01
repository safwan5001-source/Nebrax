# CUST-H2 — Multi-Page Visual Builder — Horizon Closure Report

## Status

**CUST-H2 CLOSED.**

Owner review and merge gates are complete for CUST-H2-ARCH-1 and
CUST-H2-1 through CUST-H2-5. The final implementation Slice, CUST-H2-5,
was squash-merged as `cdcd1eb7ad7a52a3003d0c82f2cec61e17607541`.
No deployment or Production release is implied by Horizon closure.

---

## Original Horizon Objective

Extend AWJ's structured visual-editing model — introduced for Home by
CUST-H1 — to the **Product** and **Category** pages, inside the same active
design Version CUST-H1 already established, closing the full chain:

```
Customizer Page Preview
        ↓
pagePresentation.{product,category}
        ↓
Version Draft
        ↓
Published Snapshot
        ↓
Public Storefront Product/Category Renderer
```

Per `docs/plans/store/CUST-H2-ARCH-1-PAGE-CONTRACT.md`'s own "Public Runtime
Mapping": *"This chain is only fully closed in CUST-H2-5."*

---

## All Slices, In Order

| Slice | Scope | PR | Status |
|---|---|---|---|
| **CUST-H2-ARCH-1** | Architecture: `pagePresentation` additive schema, Page Type Registry, Page Capability Registry, region contracts for Product/Category, schema bump 2→3 | #1116 · `ce97b2d3367c954af5e353a4df058635fdfa1918` | Merged |
| **CUST-H2-1** | Schema/registry foundation: PHP + TS twin normalizers, closed region-key unions, fail-closed tests. No UI, no public runtime. | #1117 · `19cbe6da128eaf8f7a36369a69131b3560e0aeb5` | Merged |
| **CUST-H2-2** | Page Navigator + page-aware Canvas shell (Customizer UI only) | #1118 · `60db405ed9fcdeb118de66c525943647ad6548bb` | Merged |
| **CUST-H2-3** | Product page structured editing: region instances, Preview Product picker, workspace product-read API | #1119 · `3b8c1d18182459bfe0047d4b6dbaa06fceded481` | Merged |
| **CUST-H2-4** | Category page structured editing: same shape for Category, workspace category-read API | #1129 · `2f4a35e71ed4769757ccdb6003f8be68dc228cbc` | Merged |
| **CUST-H2-5** | Cross-page public runtime parity: the public Product/Category pages now read `pagePresentation`; integrated Home/Product/Category QA | #1134 · `cdcd1eb7ad7a52a3003d0c82f2cec61e17607541` | Merged |

CUST-H2's final merge baseline is
`cdcd1eb7ad7a52a3003d0c82f2cec61e17607541`.

---

## Key Architectural / Product Decisions (across the whole Horizon)

- **Additive JSON namespace, not a new table.** `pagePresentation` lives
  entirely inside the existing `config` JSON column on
  `storefront_presentation_versions` — zero DB migration across all five
  Slices (ARCH-1's own "Rejected Alternatives" #2–#4).
- **Region vocabulary distinct from Home's section vocabulary.** Home's
  `PresentationHomeSection` (repeatable, mostly-optional) and the new
  `PageRegionInstance<K>` (mostly FIXED_REQUIRED, non-repeatable in H2 V1)
  are deliberately separate contracts — conflating them would have implied
  reorderable/deletable-by-default semantics that are false for a PDP/PLP.
- **Preview entity selection is editor context, never persisted authority**
  (CUST-H2-3/H2-4) — the previewed Product/Category id is never written into
  `pagePresentation`, mirroring the pre-existing `viewport`/`selectedSection`
  pattern.
- **`variant_selector` is authored once, gated at render time by real
  Product data** — never a persisted `hasVariants` fact (CUST-H2-1's own
  normalizer decision, closed out for the *public* renderer by CUST-H2-5's
  force-visible/force-absent gate).
- **Version-level revision remains the sole concurrency granularity** — no
  page-level revisions were introduced anywhere in the Horizon, reusing
  CUST-H1's existing, already-tested 409 stale-revision mechanism.
- **The public renderer does not trust the Customizer's own invariants
  blindly** (CUST-H2-5's own key addition): even though the Customizer UI
  has no affordance to hide a FIXED_REQUIRED region or to un-persist
  `variant_selector`'s visibility, the public-runtime fail-safe merge
  (`mergeRegionsFailSafe`) guarantees commerce-critical regions can never
  disappear from a malformed or forward-shaped stored document.

---

## Research Sources Used Across the Horizon

- Salla: Home/Product/Category customization surface separation, global-vs-
  page-specific settings split, Product-page quick-purchase toggle
  (ARCH-1 evidence pass).
- Shopify: `enabled_on`/`disabled_on` region-to-template restriction, toolbar
  template selector visually/positionally separate from Save/preview, the
  "Preview → Change" product/collection picker pattern (ARCH-1 evidence
  pass; directly informed the Page Capability Registry and Page Navigator).
- No new external research was performed in CUST-H2-2 through CUST-H2-5 —
  each slice's own report states explicitly why re-researching the same
  already-answered questions would not have changed its decisions, and names
  the one or two genuinely new questions each slice raised, answered by
  direct code inspection instead.

---

## Test/CI Summary (per slice, as each slice's own report states)

| Slice | Backend (SQLite) | Backend (PgSQL) | Web vitest | Web build | Storefront vitest | Storefront build | Playwright |
|---|---|---|---|---|---|---|---|
| H2-1 | 191/192 relevant, 0 failed | 192/192 | 324 files / 2398 tests | ✓ | 106 files / 711 tests | ✓ | N/A (no UI) |
| H2-2 | untouched (web-only) | untouched | 325 files / 2407 tests | ✓ | untouched | untouched | 9/9 (+54/55 regression) |
| H2-3 | 908/908 (Commerce\|Presentation) | 119/119 | 2430/2430 | ✓ | untouched | untouched | 15/15 |
| H2-4 | 930/930 (Commerce\|Presentation) | 141/141 | 2457/2457 | ✓ | untouched | untouched | 23/23 |
| **H2-5** | **930/930 (Commerce\|Presentation), 95/95 lifecycle** | not re-run (zero backend diff) | untouched | untouched | **108 files / 734 tests** | ✓ | **23/23 + 12/12 Home regression** |

CI status for H2-1 through H2-4: reported green in each PR's own
implementation report. CUST-H2-5 PR #1134 also completed green after a
transient Packagist HTTP/2 502 caused the SQLite job to fail before tests;
the failed SQLite job was re-run without code changes and then passed.
Storefront CI, Store Brand QA, and the main CI workflow were green at the
owner merge gate.

---

## Production / Deployment Status

**All five implementation Slices have been merged. None has been deployed
or Production-released as part of this Horizon closure.** Merge approval and
deployment approval remain separate owner gates. No Production release has
occurred as part of CUST-H2.ION RELEASE**, even with
green CI, until the owner explicitly approves.

---

## Remaining Gaps / Follow-up Horizons

Carried forward from CUST-H2-1 through H2-4's own "Explicitly Deferred"
sections, still open after H2-5:

- **`custom_fields` is a fully dead Product region** for every real AWJ
  product today (no data model exists in AWJ's own catalog — a
  Spree-wholesale-only concept). A future product decision should either
  build real custom fields for AWJ's catalog or formally deprecate the
  region; not resolved in this Horizon.
- **The accepted ~45px residual toolbar overflow at exactly 1024px AR**
  (CUST-H1-5's own pre-existing finding, measured again by H2-2/H2-3/H2-4) —
  Customizer-only, unrelated to H2-5's public-runtime scope, not fixed in
  this Horizon.
- **`setup.sh`'s `app/Mail`/`resources/views` local-build-tool gap** (found
  during CUST-H2-4's own full-suite pass) — confirmed never CI-visible; a
  deferred, independent follow-up outside Store/Customizer scope.
- **Deferred Product/Category regions** (`specifications`, `related_products`,
  `trust_shipping_payment`, `category_banner_image`, `promotional_content`)
  — no data model exists for any; none were added anywhere in this Horizon.
- **The Preview Product/Category picker's underlying workspace API** — built
  in H2-3/H2-4 specifically to unblock the picker; no further gap remains
  there.
- **A full Playwright responsive/RTL/visual QA pass at every one of the
  task's named widths, for every slice** — each slice's own report names
  its own honest partial-coverage gap (H2-2 §Responsive, H2-3/H2-4
  §Risks/Remaining, H2-5 §Risks/Remaining above); none claims 100% Cartesian
  coverage, consistent with the task's own "do not mechanically generate
  every Cartesian screenshot" instruction.
- **True authenticated Customizer → Publish → public-route E2E** — no
  Docker/live-backend path exists in the environments these Horizon's
  sessions have run in; every Playwright pass across the Horizon that needed
  real data used a dev-only fixture route instead, explicitly disclosed as
  fixture/mocked-backend evidence rather than claimed as full E2E. A future
  Horizon (or CI environment change) that provisions a live backend for
  Playwright would let this become true E2E without any change to the
  application code itself — the public renderer and the Customizer both
  already consume the *same* Published-snapshot contract.
- **CUST-H3 — Store Identity Studio** — the next Horizon on the roadmap
  after CUST-H2 closes, not started.

---

## Horizon Closure Checklist

- **H2-1 — schema/registry foundation:** ✓ implemented, tested (PHP/TS
  parity across three normalizer twins), merged via PR #1117.
- **H2-2 — Page Navigator/page-aware Canvas:** ✓ implemented, tested
  (Playwright + vitest), merged via PR #1118.
- **H2-3 — Product structured editor + preview API:** ✓ implemented, tested,
  merged via PR #1119.
- **H2-4 — Category structured editor + preview API:** ✓ implemented,
  tested, merged via PR #1129.
- **H2-5 — public Product runtime:** ✓ implemented this PR — region
  order/visibility/data-absence/malformed-safety all verified by real
  component tests and real-browser Playwright evidence.
- **H2-5 — public Category runtime:** ✓ implemented this PR — same
  verification depth.
- **H2-5 — cross-page parity:** ✓ Product and Category both resolve from the
  identical `fetchPublishedPresentation()` call the Home/chrome shell
  already makes; a single Published Version carries all three pages'
  presentation atomically (existing H1 mechanism, re-verified, not
  re-implemented).
- **Home unchanged:** ✓ zero Home file touched in H2-5's own diff; existing
  `store-brand-qa.spec.ts` fixture scenarios re-run green (12/12) as direct
  regression evidence.
- **Product works:** ✓ real component tests + real-browser Playwright,
  including variant/non-variant, hidden/reordered regions, data-absence,
  malformed-safety.
- **Category works:** ✓ same verification depth.
- **Page switching works:** ✓ (CUST-H2-2, re-confirmed unaffected by later
  slices' own regression passes).
- **Version switching works:** ✓ (CUST-H2-2/H2-3/H2-4, re-confirmed
  unaffected).
- **Save works:** ✓ (CUST-H2-1's own lifecycle tests, re-confirmed green in
  H2-5's own backend regression run).
- **Publish works:** ✓ (CUST-H2-1's own lifecycle tests, including the
  specific "public storefront renders the newly published version" test,
  re-confirmed green).
- **Schedule works:** ✓ (CUST-H2-1's own scheduled-publish lifecycle test,
  re-confirmed green).
- **Draft never leaks:** ✓ the public renderer's only read path
  (`publishedSnapshotForStorefront()`) structurally cannot reach
  `draft_config` — re-verified, not newly built, by H2-5.
- **Tenant isolation preserved:** ✓ no new endpoint/authority surface;
  full `Commerce|StorefrontPresentation` backend suite re-run green
  (930/930).
- **RTL/LTR:** ✓ verified across Home (pre-existing suite) + Product +
  Category (this slice's new suite), both locales, real browser.
- **Mobile/desktop:** ✓ 390–1440px real-browser coverage across all three
  page types (see H2-5's own "Responsive QA" section for the exact matrix
  and its own honestly-named gaps).
- **Accessibility:** ✓ heading hierarchy, landmark semantics, and DOM/focus
  order following resolved region order verified for Product and Category;
  no drag-and-drop-only reorder mechanism anywhere in the Horizon's editor.
- **Backward compatibility:** ✓ every pre-CUST-H2 Version, and every
  Version with no authored `pagePresentation`, renders byte-identically to
  `main` on both the Customizer and the public storefront.
- **No DB migration:** ✓ zero migrations across all five Slices.
- **No accounting impact:** ✓ no Slice in this Horizon introduces a
  financial operation, a `LedgerService` call, or a journal entry.

---

## Confirmation

**CUST-H2 is CLOSED** against the architecture doc's Implementation Slicing
table and Public Runtime Mapping chain. Owner review and merge gates were
completed in dependency order through PR #1134, with final CUST-H2 baseline
`cdcd1eb7ad7a52a3003d0c82f2cec61e17607541`.

This closure does **not** authorize Deploy or Production release. Those
remain separate explicit owner decisions.

**CUST-H2 CLOSED.**

---

## Next Step

**CUST-H3 — Store Identity Studio.**

Begin with an evidence-first architecture/UX pass against the current merged
Customizer implementation before authorizing implementation slices.
