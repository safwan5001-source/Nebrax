# AWJ Market — Horizon Master Execution Task

**Status:** READY FOR HORIZON IMPLEMENTATION  
**Repository:** `safwan5001-source/Nebrax`  
**Authorized base:** `main@553034281666c16dde3b7d82dc0b1355c8710c50`  
**Master specification:** `docs/commerce/AWJ_MARKET_SHONA_EVIDENCE_GAP_PASS.md`  
**Benchmark:** `https://store.shonaksa.com/`

## 1. Mission

Implement the **AWJ Market** ready storefront theme as one coordinated implementation horizon.

AWJ Market is a high-density retail/grocery/FMCG presentation preset over the existing AWJ storefront and Commerce contracts. It is not a second storefront runtime and not a fork of commerce business logic.

The merged Master Spec is authoritative for architecture, capability gates, security, tenant isolation, truthful commerce, compatibility and acceptance. Read it first. Do not repeat broad repository discovery.

The live Shona storefront is the mandatory UI/UX benchmark. Perform the Master Spec's Shona UI/UX Extraction Contract before final visual closure, and reconcile the finished implementation against both the live benchmark and AWJ requirements.

## 2. Base and scope discipline

1. Start from the exact authorized base above. If `origin/main` has moved, report the new SHA and inspect only intervening changes that overlap this task. Do not silently build on an unknown base.
2. Keep scope limited to AWJ Market and generic backward-compatible presentation seams needed to support it.
3. Do not refactor unrelated storefront, Commerce, accounting, inventory, payments or App Builder code.
4. Do not change financial/accounting rules, database schema, inventory posting, price authority, tenant resolution, public API semantics or checkout monetary authority merely to match the benchmark.
5. Do not merge or deploy. Open a PR and stop for review unless a later explicit owner instruction changes that gate.

## 3. Non-negotiable architecture

- Register `awj-market` atomically in every authoritative/mirrored closed preset set:
  - PHP StorefrontPresentationNormalizer;
  - storefront presentation tokens/config;
  - production web Store Experience Builder tokens/config.
- Unknown/stale preset values must continue to fail closed to `awj-modern`.
- Do not change global presentation defaults to Market.
- No-presentation stores must remain AWJ Modern.
- AWJ Market selection is a one-time explicit starting-bundle application, not a normalizer that repeatedly overwrites merchant choices.
- Initial Market bundle:
  - `themePreset = awj-market`;
  - density `compact`;
  - product card `compact`;
  - header style `compact`;
  - preserve unrelated merchant branding/content/contact/social/app/policy fields;
  - never auto-enable gated homepage capabilities.
- After selection, supported fields remain independently merchant-editable.
- Do not create a Market route tree, Market commerce service, Market cart, Market checkout or Market product source.
- Use shared theme-aware presentation seams and existing Commerce truth.

## 4. Mandatory Shona UI/UX extraction

Inspect the live benchmark on representative desktop and mobile journeys. Do not stop at the homepage.

Extract and compare:
- global shell/header/search/category navigation/footer/mobile navigation;
- homepage composition and vertical rhythm;
- product-card proportions, hierarchy, density and interaction;
- catalog/category/search behavior;
- PDP/media/variant/quantity/add-to-cart hierarchy;
- cart behavior;
- publicly observable checkout continuity;
- content/trust/FAQ/location/app/contact surfaces;
- responsive transformations;
- hover/focus/pressed/selected/disabled/loading/error/empty states;
- spacing, typography hierarchy, radius, borders, shadows, image treatment and density.

For every material benchmark pattern classify:
**Observed Shona behavior → AWJ existing capability → AWJ adaptation → gap/gate → decision.**

Never infer backend truth from visual appearance.

Do not copy Shona branding, logos, product/banner assets, merchant copy, testimonials, policy/business text, proprietary source code/CSS/JS, tracking IDs, credentials or private implementation details. Implement original AWJ components/styles using AWJ contracts and merchant content.

If a public benchmark surface/state cannot be observed, mark it `NOT OBSERVED`.

## 5. Capability gates — do not fake

Do not activate or simulate unsupported capabilities, including:
- public multi-location/branch availability or customer branch selector;
- pickup/click-and-collect;
- authoritative compare-at/original-price/offers without the shared promotion authority;
- coupon monetary behavior without server authority;
- persistent wishlist unless the real identity/persistence contract is live;
- ratings/reviews;
- purchase-count social proof;
- public barcode/GTIN semantics beyond the existing explicit contract;
- arbitrary map iframe/merchant HTML;
- catalog facets not backed by server queries;
- search suggestions/trending/recent searches;
- unsupported payment/shipping/tax claims.

Use the Master Spec classifications. A visually attractive fake capability is a failure.

## 6. Implementation surfaces

### Production Customizer
Primary merchant editor:
- `web/src/modules/store-experience-builder/ExperienceBuilder.tsx`
- `ControlPanels.tsx`
- `StorefrontPreviewCanvas.tsx`
- presentation tokens/config/messages as needed.

Add AWJ Market as a ready theme/preset through the existing Draft/Save/Publish architecture. Do not create a second composer.

### Public shell
Use the existing shared storefront layout and:
- Header;
- CategoryNav;
- MobileBottomNav;
- Footer;
- StoreWhatsApp;
- StoreContainer.

### Homepage
Work through the existing homepage renderer and implemented sections:
- HeroSection;
- CategoriesSection;
- NewArrivalsSection;
- WholesaleSection.

Do not activate currently gated section types solely because Shona shows analogous content.

### Product browsing
Use shared:
- ProductListing;
- InfiniteProductList;
- ProductGrid;
- NewArrivals;
- ProductCarousel;
- ProductCard;
- skeletons.

Any ProductCard change must be theme-aware/generic because it is reused outside the Market homepage.

### PDP
Reuse existing product/media/variant/price/availability contracts and generic option system. No hard-coded color/size assumptions.

### Cart
Use the existing CartDrawer/page/line/summary architecture. Preserve server-sent monetary authority and wholesale reuse boundaries.

### Checkout
Preserve the dedicated `(store-checkout)` shell, `AwjCheckoutFlow` and existing stages. Market may harmonize visual tokens/density where appropriate but must not reintroduce marketing chrome or fork checkout business logic.

## 7. Visual acceptance

Verify at: **390, 430, 768, 1024, 1280, 1440 px**.

Verify both:
- Arabic RTL;
- English LTR.

Required:
- no horizontal overflow;
- correct logical-direction behavior/icons;
- usable touch targets;
- fixed/sticky controls do not obscure content;
- long Arabic grocery/FMCG names remain stable;
- mixed Arabic/Latin/SKU/English numerals remain stable;
- mobile shopping remains fast and dense;
- desktop density scales without harming readability.

Cover meaningful states:
- loading/skeleton;
- empty catalog;
- search no-results;
- missing media;
- simple product;
- variant product before/after selection;
- unavailable combination;
- in-stock/out-of-stock/unknown availability;
- long names/content;
- cart empty/non-empty;
- mutation/rejection/error where existing architecture exposes it;
- branding configured/absent;
- optional content configured/absent;
- Draft preview versus Published runtime.

## 8. Security, tenant isolation and truthful commerce

Must remain true:
- tenant boundaries fail closed;
- Draft does not leak publicly before Publish;
- public runtime consumes Published presentation only;
- browser-selected warehouse IDs never become stock authority;
- no raw stock quantity, cost, margin, valuation or accounting data becomes public;
- price/discount/tax/delivery/stock authority stays server-side;
- no arbitrary executable merchant HTML/CSS/JS/iframe;
- no IDOR regression;
- no weakening publication eligibility;
- no duplicate Market business source of truth.

## 9. Performance and accessibility

Do not introduce:
- per-card product-detail fetches;
- per-card inventory requests/client N+1;
- duplicate storefront config/catalog fetches only to detect theme;
- avoidable image/layout shift;
- unnecessary client components.

Preserve/improve:
- semantic landmarks/headings;
- keyboard navigation;
- visible focus;
- accessible names for icon controls;
- disabled/pending/error semantics;
- no color-only communication;
- RTL/LTR logical order;
- reduced-motion behavior where applicable.

Any performance claim in the final report must be measured or explicitly labeled unmeasured.

## 10. Required tests

At minimum add/extend focused regression coverage proving:

1. `awj-market` accepted identically by PHP, storefront TS and web Customizer normalization.
2. unknown preset → `awj-modern`.
3. no-presentation storefront remains AWJ Modern.
4. selecting Market applies the starting bundle without erasing unrelated merchant fields.
5. later merchant overrides are not reset by normalization/reload.
6. Draft Market changes do not leak publicly.
7. Publish exposes normalized Market configuration.
8. stale revision behavior remains correct.
9. cross-tenant presentation access remains denied/404 according to current contract.
10. existing AWJ Modern behavior/tests remain green.
11. gated homepage section types remain absent unless independently activated by an approved capability.
12. theme rendering exposes no raw inventory/cost/accounting data.
13. RTL/LTR and relevant responsive behavior remain clean.
14. cart/checkout authority tests remain green if shared presentation surfaces are touched.

Run progressively:
1. focused changed-area tests;
2. storefront lint/typecheck/tests/build;
3. web tests/build relevant to Customizer;
4. backend presentation tests if PHP normalization/persistence is touched;
5. broader suites only where justified by shared changes.

Do not reduce financial/security/tenant-isolation coverage.

## 11. Execution order

1. Verify base and read Master Spec.
2. Perform focused Shona benchmark extraction.
3. Register preset in all mirrored/authoritative closed sets.
4. Implement explicit Market starting-bundle behavior in production Customizer.
5. Add shared theme marker/token seam if required.
6. Implement Market shell/home/catalog/product/PDP/cart presentation through shared components.
7. Harmonize checkout only within its existing architectural boundary.
8. Verify Customizer Draft/Preview/Publish/public parity.
9. Run focused tests.
10. Run storefront/web/backend suites justified by changes.
11. Perform the full responsive + RTL/LTR visual matrix.
12. Reconcile final result against live Shona and the Master Spec.
13. Open one bounded PR.
14. Produce the final implementation report.
15. STOP before merge/deploy.

## 12. Required Shona → AWJ parity matrix

Final report must include:

| Surface / pattern | Shona evidence | AWJ implementation/adaptation | Status | Reason for divergence |
|---|---|---|---|---|

Allowed status:
- `MATCHED`
- `ADAPTED`
- `GATED`
- `DEFERRED`
- `REJECTED`
- `NOT OBSERVED`

List every materially visible Shona behavior intentionally absent from AWJ Market and explain why.

## 13. Final implementation report

Create a durable Markdown report in the repository and include:

- scope and exclusions;
- exact Base SHA;
- Branch;
- PR;
- Head SHA;
- implementation summary by surface;
- changed files grouped by responsibility;
- contracts/components reused;
- any generic shared seam added and why;
- capability gates kept inactive;
- Shona → AWJ UI/UX Parity Matrix;
- focused tests and exact results;
- storefront lint/typecheck/test/build;
- web tests/build;
- backend tests where applicable;
- visual acceptance matrix for all required widths and RTL/LTR;
- accessibility review;
- performance evidence, with unmeasured claims explicitly marked;
- tenant isolation/security/backward compatibility review;
- AWJ Modern regression result;
- risks/remaining work;
- CI status;
- merge state;
- deploy state;
- recommended next action.

## 14. Stop / escalation conditions

Stop and report rather than inventing a contract if:
- the benchmark requires a capability marked gated/missing;
- implementation would require DB/API/accounting/inventory/payment authority changes;
- a material ambiguity conflicts with the Master Spec;
- a shared change would break AWJ Modern/backward compatibility;
- tenant/security boundaries cannot be preserved;
- live Shona evidence contradicts an assumption materially enough to change authorized scope.

Do not broaden the horizon to solve those gaps.

## Definition of Done

AWJ Market is implementation-complete only when:
- the ready theme is selectable in the production Customizer;
- Draft/Preview/Publish/public behavior works through existing architecture;
- the shared storefront renders the Market experience without a business-logic fork;
- required tests/builds are green;
- required responsive RTL/LTR visual acceptance is evidenced;
- Shona UI/UX extraction and final parity reconciliation are documented;
- gated capabilities remain honest;
- AWJ Modern/backward compatibility remains intact;
- one reviewable PR and final MD report exist.

**Merge and deployment are explicitly outside this Horizon authorization.**
