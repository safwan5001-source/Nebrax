# CUST-HV V11 — Integrated Verification & Horizon Closure Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V11** — the last slice. Verifies V1A → V10d as one product and closes the Horizon. |
| **Branch** | `cust-hv/v11-closure`, cut from `main` at `277b6a9f` (V10d merged). |
| **Authority** | `CUST-HV-MASTER-HORIZON-EXECUTION.md` §6 (V11) and §13 (completion rule); `CUST-HV-V0-DECISIONS-AND-ARCHITECTURE-CONTRACT.md`. |
| **Scope of this PR** | One backward-compatibility proof (the pre-Horizon golden document), this report, and one stale line corrected in the V10d report. **No product code, endpoint, schema, Publish rule or accounting change.** `PRESENTATION_CONFIG_VERSION` stays 3. |

## Result

**Every slice V1A → V10d is implemented and merged.** The integrated suites pass on `main` + this PR; the items that cannot be proven from this environment, and the capabilities deliberately left for later, are listed — not hidden — in *Accepted risks* and *Owner-deferred capabilities*. **Deploy: NOT PERFORMED. Production release: NOT PERFORMED.** Nothing in this report claims a Production verification that has not happened.

## 1. Slice ledger (what was delivered, in merge order)

Every row was a focused PR, squash-merged under the Owner's sequential-merge authorization after its gates (focused + broader tests, CI Gate green, legitimate review findings resolved, Design Quality Pass, invariants). Each has its own `CUST-HV-<slice>-IMPLEMENTATION-REPORT.md` in this folder.

| Area | Slices → PRs |
|---|---|
| Authority | V0 contract #1232 · master gap #1230 · master horizon plan #1244 |
| Defects + toolbar | V1A #1252 |
| Media domain | V2a #1255 · V2b #1262 · V2c #1263 |
| Announcement bar | V3 #1259 |
| Media in the product | V4a #1264 · V4b #1265 |
| Visual contract, contrast, design inspector (incl. V1B editing surfaces) | V5a #1266 · V5b #1267 · V5c #1268 · V5d #1269 |
| Typography, global tokens, buttons, fonts, separators | V5e-1 #1270 · V5e-2a #1271 · V5e-2b #1272 (+#1273) · V5e-2c #1274 · V5e-3 #1275 |
| Hero / Banner | V6a #1276 · V6b-1…5 #1277–#1281 · V6c-1…7 #1282–#1289 |
| Header / Navigation / Footer | V7a #1292 · V7b #1294 · V7c-1 #1295 · V7c-2 #1296 · V7d #1297 · V7d-4 #1298 · V7e-1 #1299 · V7e-2 #1300 · V7e-3 #1301 |
| Slider / Gallery | V8a #1303 · V8b #1306 · V8c-1 #1307 · V8c-2 #1309 · V8d #1310 · V8e #1311 · V8f #1313 |
| Cards, shelves, category cover, content blocks, product zoom, commerce firewall | V9a #1317 · V9b #1319 · V9c-1 #1321 · V9c-2 #1322 · V9d-1 #1329 · V9d-2 #1336 · V9d-3 #1337 · V9d-4 #1338 · V9e #1344 |
| Themes and section workflow | V10a #1345 · V10b #1349 · V10c #1353 · V10d #1357 |

## 2. Integrated verification run

All run on `main` (`277b6a9f`) + this PR's single commit, in the same container, on 2026-10-12.

| Suite | Result |
|---|---|
| PHP — full `php artisan test` (SQLite) | **6421 passed, 73 skipped, 28 failed** (47 395 assertions). The 28 are the known **container-only** set and nothing else: 26 `Fuel*` tests (six classes; this container lacks `ext-bcmath`), `ResendMailTransportTest`, `UserInvitationTest` (missing mail view in the container's app skeleton). All 28 pass in CI, where each PR's `php artisan test (L11, sqlite)` **and** `(L11, pgsql)` were green. |
| Web — full `vitest run` | **500 files, 5251 tests passed.** |
| Storefront — full `vitest run` | **196 files passed (15 skipped), 2461 tests passed.** `tsc --noEmit` clean; biome: 0 errors (2 pre-existing warnings). |
| Real Chromium — every CUST-HV spec (`cust-hv-*`, `flowers-h15-bloom-theme`, `store-brand-qa`), `--project=desktop` | **28 spec files, 350 tests passed, 0 failed, 0 flaky** (20.5 min, one worker, `--project=desktop`; each spec sets its own viewport and locale — AR RTL and EN LTR across 390 · 768 · 1024 · 1280 · 1440 as each feature requires, plus the simulated-phone device frame). |
| CI per PR | Each slice PR merged only with **CI Gate green** (web build, storefront lint + typecheck + test, merchant-preview and published-footer visual QA, PHP on SQLite and PostgreSQL). Environmental failures (runner-queue starvation of the Gate, a `next/font` fetch error) were re-run once and then passed; real failures were fixed in the PR (for example V10d's CI visual-QA overflow, traced to a positioned section wrapper and scoped away) — none was waved through. |

`tsc` over the whole `web/` project reports errors only in test files that are **not** part of this Horizon and are not exercised by `next build` (`SliderFields.test.tsx`, POS/appearance test typings); they pre-date V9e and are unchanged. Every file the Horizon touches type-checks.

## 3. The Horizon's integrated dimensions

| Required dimension (Master §V11) | Evidence in the repo |
|---|---|
| **Desktop / Tablet / Mobile; 390 / 430 / 768 / 1024 / 1280 / 1440; AR RTL; EN LTR** | Real-Chromium specs per slice run both locales across the widths each feature affects (toolbar reachability at all six widths; most editors/Canvas at 390 · 768 · 1024 · 1440; storefront renderers at the simulated device). The integrated run above re-executes all of them. Pixel evidence screenshots are produced per run under `web/test-results/`. |
| **Keyboard / accessibility** | Native controls throughout; dialogs close on Escape (`ControlPanels.deleteConfirm`), the section list keeps ↑/↓ buttons beside drag-and-drop (V10d), navigation editor has a complete button interface (V7d-4), the slider (`HomeSlider.test.tsx`: keyboard in LTR / RTL) and the gallery viewer (arrows / keyboard) are keyboard operable, with reduced-motion proofs in the V8b / V8e specs, the hover action bar opens on focus-within as well as hover. Contrast is a **publish gate** (PHP authority + TS twins, proved on real pixels in V5a / V6b-5). **Not performed here:** a manual screen-reader pass (NVDA / VoiceOver) — see *Accepted risks*. |
| **Media ownership / isolation** | `StorefrontMediaApiTest`, `StorefrontMediaDeliveryTest`, `StorefrontMediaDerivativeTest`, `StorefrontDomainMediaVisibilityTest` (tenant-scoped reads/writes, public delivery only for published references); the published-reference gate (V2c) on all four publish paths; V10a/b: a theme apply never writes a global asset into a tenant document — a theme that lists an asset **fails closed**, and a unit proof asserts no applied document holds a media reference it did not already own. |
| **Draft vs Published parity** | One normalizer contract in three places (PHP authority, merchant-app twin, storefront twin) pinned by shared JSON fixtures in `tests/Fixtures/presentation/` (byte-identical TS twins test-enforced); `StorefrontPresentationPublicRuntimeTest`, `…PublishApiTest`, `…VersionPublishApiTest`; the Canvas and storefront share resolvers and class tokens (`cust-hv-v5c-storefront-cascade.spec.ts`). Editor-only data (V10c section names) is **stripped from the public snapshot** (`StorefrontMediaRefTest`). |
| **Stale-response guards** | `ExperienceBuilder.versions.test.tsx` (late create / row-write / A→B→A switches — the request-token guards, many added from review rounds); V10b: Apply is refused until the base version is loaded and the themed pack is computed; the gallery offers a preview link only once the base version has resolved. |
| **Commerce truth** | V9d-4 — `StorefrontCommerceFirewallTest` (deny rule over a hostile document; scope survival; **deny-by-default class-owner closure**; reverse scan of every commerce service) and `StorefrontCommerceFirewallRuntimeTest` (real draft + publish round-trip proving resolver/public/workspace commerce data is byte-identical before and after hostile presentation input), mirrored in both TS twins. No presentation control can set, hide or restate a price, discount, stock, availability, offer, tax or checkout amount. |
| **Version / revision concurrency** | `a_stale_save_revision_returns_409_and_preserves_the_winner`, `a_stale_rename_revision_returns_409`, `StorefrontPresentationPostgresConcurrencyTest` (PostgreSQL job in CI); V10b's theme apply creates a **new** draft, saves with that draft's revision and **rolls the new draft back** on any failure; the Published Version is never an input to a write. |
| **Backward compatibility** | **New in V11:** `tests/Fixtures/presentation/pre-hv-golden.json` — a document carrying only keys that existed *before* the Horizon, with `expected` captured from the **pre-Horizon** PHP normalizer (commit `2a068b8c`). It is asserted in PHP (`PreHvBackwardCompatibilityTest`) and in both TS twins: a store that never used a Horizon feature normalizes to exactly what it did before (absence = default; no key appears). Plus `StorefrontPresentationLegacyCompatibilityForkTest` and `…VersionBackfillTest`. |
| **Representative realistic merchant content** | The V9d-4 hostile fixture exercises **every** scope — all 15 homepage section types, all eight custom-content block kinds with nested columns, branding, header, footer, navigation, announcements, page presentation — through all three normalizers; `flowers-h15-bloom-theme.spec.ts` drives a real merchant flow (gallery → preview → summary → apply) over realistic data; the V6b-5 / V5a specs use real photographs for contrast evidence. |
| **Production-like build / CI evidence** | `next build` (web) and the storefront lint + typecheck + test run in CI on every PR; both PHP engines run the full suite; the merchant-preview and published-footer visual QA specs run in CI. |

## 4. Defects the Horizon was opened to close — disposition

| Item | Disposition |
|---|---|
| DEF-1 header links on mobile · DEF-3a / DEF-9 / DEF-10 stale comments · DEF-4 misleading theme preview · DEF-8 / DEF-11 toolbar reachability | **Closed in V1A** (#1252). DEF-4's *true* preview was then delivered in **V10b**. |
| DEF-2 `accentColor` unused · DEF-6 delete without confirmation · DEF-7 no editing surface at 768 | **Closed in V5a–V5d** (#1266–#1269): a live palette role; delete asks first (V10c extends it to a section that carries only a name); a real 768–1023 editing surface. |
| DEF-3b category page ignored the category image | **Closed in V9a** (#1317) — optional `cover` region. |
| DEF-5 max-size logos vs the document cap / Base64 duplicated per version | **Closed in V4a / V4b** (#1264, #1265) — `MediaRef` + identity-media migration. |

## 5. Accepted risks and what was **not** verified here

These are stated so no one reads the closure as more than it is.

| Item | Status |
|---|---|
| **Manual screen-reader pass (NVDA, VoiceOver)** | **Not performed.** Automated keyboard/ARIA assertions exist; a human assistive-technology pass is an Owner-run step. |
| **Production R2 / media go-live checklist** (R2 credentials, PHP upload limits, RAM vs decode budget, a 40 MP render inside the FPM timeout — carried from V2a/V2b/V2c) | **Not verified by this closure.** It belongs to the separate media-storage horizon and to Deploy. No claim is made here. |
| **LCP / CLS on a throttled mobile profile** | **Not measured.** The Horizon added no blocking script and self-hosts fonts (V5e-2c), but no budget run was executed. |
| **Shared-cache window after unpublish** | Up to 5 minutes in a cache in front of the media proxy (AMEND-16); the origin stops at once. Stated since V2c. |
| **Media reconciler is manual** (no scheduler in Production) | Purge timing is an operations action (V2c). |
| **Orphan derivative rows from unsaved crops** | Bounded (200 / asset, 4 000 / tenant) and reaped by the manual reconciler after 24 h (V4b). |
| **Dismissed announcement flashes one frame** before the stored dismissal is read | Accepted (V3). |
| **Theme apply base is the document at load time** | Edits made elsewhere after opening a preview are not reflected until reload (V10b). |
| **Product Media EXIF-orientation latent defect** | Reported in V2a, deliberately not changed. |

## 6. Owner-deferred capabilities (documented rationale in each slice report)

None of these blocks a frozen V0 contract; each was left out on purpose and is recorded where it was decided.

- **Theme stock imagery / clone-on-apply** (AMEND-6): needs a global tenant-less asset store and a server-side R2 copy — new infrastructure. Gated fail-closed (`assets_unsupported`); no built-in theme ships imagery. *(V10a)*
- **Merchant font upload** (V0 §5.4): needs a proven `storefront-fonts` media domain, `woff2` validation, a licensing acknowledgement and a CSP review. *(V5e-2c)*
- **User-saved section presets** and cross-page copy (V0 §17.3 LATER); **mega menu** (reserved); **masonry / collage**; **gallery thumbnail-placement variants**, pinch-zoom and zoom level (V0 §14.2 LATER); **touch long-press drag**; drag-and-drop in the navigation editor (buttons are the complete interface). *(V7d-4, V8d, V9e, V10c, V10d)*
- **Slider:** per-slide button style / colour, `layout: split`, `mediaTreatment.aspect` / `fit`. **Button `icon`**, and `soft` / `colour` beyond Hero and Banner. *(V6c-6, V8a)*
- **Header / footer:** media, gradient and alpha surfaces, `logo.treatment` (mono variants), `linkHover`, divider kind / height, border, per-item and CTA icons; the automatic header scrim (unreachable under the proof). *(V7b, V7c-2, V7e-1)*
- **Cards and shelves:** card `background` / `padding` (needs a contrast gate over product copy) and `badgePosition` (needs collision-free placement); category-tile cards; `count` for selection-based shelves; title alignment, per-section subtitle and heading level. *(V9d-1…3)*
- **Workspace category API does not expose `image`**, so the Canvas shows an honest cover placeholder rather than the live picture. *(V9a)*
- **Toolbar-level media-readiness aggregate chip** (per-usage state is inline; a Publish rejection is explained in the toolbar). *(V4b)*
- **Custom domains / edge / TLS, App Builder, App Factory** are separate programmes (Commerce architecture docs), untouched.

## 7. Invariants, as verified over the whole Horizon

Tenant isolation · authN/authZ (every merchant write goes through the existing authorised version / media endpoints; the theme gallery and builder require `commerce.manage`; platform and tenant surfaces stay separate) · Draft vs Published (Published is never an input to a write; theme apply = a new Draft) · revision concurrency (409 on stale save; rollback of a half-applied draft) · media ownership (tenant-only references; the published-reference gate) · **commerce firewall** (no presentation control touches price, stock, offer, tax or checkout truth; no journal entry anywhere in the Horizon) · accessibility gates (contrast as a publish rule) · backward compatibility (golden pre-Horizon document; every new key is additive and absent-by-default) · no arbitrary merchant CSS / JS / HTML / free-form positioning (closed token lists only).

## 8. Completion rule (Master §13)

1. V1A → V11 are implemented, or explicitly Owner-deferred with a documented rationale (§6). ✔
2. All required slice PRs reviewed and merged under the Owner's authorization. ✔ (PR numbers in §1.)
3. V11 integrated verification passes. ✔ (§2 — within the stated environment limits of §5.)
4. Remaining risks documented. ✔ (§5, §6.) *Acceptance of those risks is the Owner's.*
5. Closure report created. ✔ (this document.)
6. No required Deploy / Production verification is marked complete before it occurs. ✔ — none is claimed.

After closure the roadmap proceeds to **CUST-H5 — Undo / Redo, Recovery & Change Confidence**, then **CUST-H6 — Advanced Extensibility**; their numbering is unchanged.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
