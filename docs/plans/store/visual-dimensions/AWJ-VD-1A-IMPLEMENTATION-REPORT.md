# AWJ-VD-1A — Implementation Report (Facet visual contract)

STATUS: **PR-READY — in review, not merged** (merge needs explicit owner approval, D-14)
DATE: 2026-10-14
HORIZON: AWJ-COMMERCE-VISUAL-DIMENSIONS-H1 · slice VD-1a (H1-1)
AUTHORITY: G0 closed by the owner on 2026-10-14 (D-01..D-17 approved). The owner authorized VD-1a explicitly.

## Outcome

This slice delivers the **pure, shared contract** for facet and facet-value visual identity: normalization (lenient for reads, strict for writes), per-property inheritance resolution with the render-time fallback, the closed shape/size/fit lists, and the D-10 icon additions. The PHP authority and two byte-identical TypeScript twins (web and storefront) are pinned by two shared fixtures.

**Not touched:** database, migrations, API routes, controllers, services, storefront rendering, and the admin UI. Nothing in the running product changes except that 28 new icons become selectable wherever `IconRegistry` is already used, because the registry list is append-only.

## Repository evidence

- `docs/plans/store/visual-dimensions/AWJ-VD-H1-0-EVIDENCE-AND-ARCHITECTURE.md` §3.3–§3.6 (merged at `d5dfa16`).
- Reused, not duplicated:
  - `StorefrontMediaRefNormalizer` / `normalizeMediaRef`, for the media id, focal point, alt text and decorative flag.
  - `IconRegistry` and `icon-registry.ts`, extended append-only.
  - The shared-fixture twin pattern used by `media-ref.json` and `data-sections.json`.
- All 28 new icon glyphs were checked against the installed `lucide-react` in both apps: web 0.460.0 and storefront 0.577.0.

## Approach

| Piece | PHP (authority) | TS twins (web = storefront, byte-identical) |
|---|---|---|
| Closed lists | `App\Support\Commerce\FacetVisualRegistry` | `FACET_VISUAL_*` in `facet-visual.ts` (+ shape labels AR/EN) |
| Lenient normalization (reads) | `CommerceFacetVisualNormalizer::normalizeValue()` / `normalizeFacet()` | `normalizeFacetValueVisual()` / `normalizeFacetVisual()` |
| Strict validation (writes, D-11) | `CommerceFacetVisualNormalizer::errors($raw, 'value'\|'facet')` → `[{field, code}]` | — (writes are server-side) |
| Inheritance + fallback (D-08) | `CommerceFacetVisualResolver::resolveValue()` / `resolveFacetSelf()` → `{visual, sources}` | `resolveFacetValueVisual()` / `resolveFacetSelfVisual()` |
| Icons (D-10) | `IconRegistry::KEYS` +28 (24 → 52) | `ICON_KEYS` / `ICON_REGISTRY` +28, plus glyphs in both `StoreIcon` renderers |

**Contract details:**
- An absent key means "inherit". `null` means "inherit" in strict validation. `{}` is a valid empty visual (the D-17 tombstone).
- The image is a `MediaRef` subset: `mediaId · fit · focal · zoom · alt · decorative`.
  - `crop` and `rotate` can never survive normalization; strict validation rejects them with `forbidden` (D-09).
  - `fit` is stored explicitly, even when it is `cover`, because its absence means inherit.
  - `zoom` is clamped to [1, 3] and rounded half away from zero to 2 dp, matching PHP `round()`. A zoom of 1 is not stored.
- Colours accept `#rrggbb` only, stored lowercase, with no trimming.
- Key order is fixed, and a normalized document is a fixed point.
- Every property resolves on its own chain (§3.6):
  - `shape`, `size`, `showLabel`: section → value → facet defaults → template → system.
  - `content`: value → implicit from the value's own media → facet defaults → `none`.
  - `icon`: value → facet defaults.
  - `iconColor`, `background`: value → facet defaults → theme.
  - `image`: the value only (never inherited).
  - `image.fit`: value → facet defaults → `cover`.
- The render-time fallback is image → icon → text. It keeps the resolved shape, size and label.
- `sources` reports where each property came from (`section`/`value`/`implicit`/`facet`/`template`/`system`). It is what the VD-3 editor will use for its "inherited from…" badges.
- The resolver is pure. Media usability is passed in as `usableMediaIds` (`null` means assume usable, for previews). VD-1b and VD-1c will supply the real tenant-owned and ready set.

## Why this fits AWJ

- One source of truth for the presentation contract: the PHP authority, TS twins, and shared fixtures. This is the same pattern as `MediaRef` and data sections.
- No parallel media rules: the facet image goes through `StorefrontMediaRefNormalizer`.
- Additive and append-only, with no change to stored documents or existing APIs.

## Changed files

**New:**
- `app/Support/Commerce/FacetVisualRegistry.php`
- `app/Support/Commerce/CommerceFacetVisualNormalizer.php`
- `app/Support/Commerce/CommerceFacetVisualResolver.php`
- `storefront/src/lib/presentation/facet-visual.ts`
- `web/src/modules/store-experience-builder/presentation/facet-visual.ts` (byte-identical twin)
- `tests/Fixtures/presentation/facet-visual.json` (29 value + 8 facet cases)
- `tests/Fixtures/presentation/facet-visual-inheritance.json` (19 value + 3 facet-self cases)
- `tests/Feature/CommerceFacetVisualContractTest.php`
- `storefront/src/lib/presentation/__tests__/facet-visual.test.ts`
- `web/src/modules/store-experience-builder/__tests__/facet-visual.test.ts`
- `docs/plans/store/visual-dimensions/AWJ-VD-1A-IMPLEMENTATION-REPORT.md`

**Modified:**
- `app/Support/Commerce/IconRegistry.php` (+28 keys, appended)
- `storefront/src/lib/presentation/icon-registry.ts`
- `web/src/modules/store-experience-builder/presentation/icon-registry.ts` (twins, +28 entries)
- `storefront/src/components/ui/store-icon.tsx`
- `web/src/modules/store-experience-builder/StoreIcon.tsx` (+28 glyphs)
- `storefront/src/lib/presentation/__tests__/icon-registry.test.ts`
- `web/src/modules/store-experience-builder/__tests__/icon-registry.test.tsx` (pinned list extended)
- `tests/Feature/StorefrontNavigationTest.php` (registry count 24 → 52)
- Horizon state:
  - `AWJ-VD-H1-TASK-QUEUE.md`
  - `AWJ-VD-H1-MASTER-PLAN.md`
  - `AWJ-VD-H1-DECISION-REGISTER.md` (G0 closed, all decisions APPROVED)
  - `docs/autonomous-engineering/CURRENT-STATE.md`

## Tests and exact results (local)

| Suite | Command | Result |
|---|---|---|
| PHP focused | `php artisan test --filter='CommerceFacetVisualContractTest\|StorefrontNavigationTest'` | **16 passed (311 assertions)** |
| PHP full | `php artisan test --parallel --processes=4` (SQLite, CI-parity environment) | **OK — 6907 tests, 51901 assertions, 0 failures, 95 skipped** |
| Storefront focused | `vitest run facet-visual, icon-registry, store-icon` | **69 passed** |
| Storefront full | `pnpm test` | **197 files passed / 15 skipped; 2523 tests passed / 15 skipped** |
| Storefront static | `pnpm check` (Biome) · `pnpm check:locales` · `npx tsc --noEmit` | Biome: 0 errors (2 warnings + 2 infos are pre-existing, in files this PR does not touch) · locales in sync · tsc exit 0 |
| Web focused | `vitest run facet-visual, icon-registry` | **65 passed** |
| Web full | `npm run test` | **597 files / 6585 tests passed** |
| Web build | `npm run build` | **Compiled successfully; 189/189 static pages** |

**Notes on local verification:**
- **The local test app was brought to CI parity before the full run.** Earlier full runs failed for environmental reasons only, all traced to differences between the local `setup.sh` and `.github/workflows/ci.yml`, never to this change:
  - **148 failures:** `Class "Aws\Exception\AwsException" not found`. CI installs `league/flysystem-aws-s3-v3`, `predis` and ParaTest; `setup.sh` does not.
  - **38 failures:**
    - `bcmul()` undefined: CI enables the `bcmath` extension.
    - `App\Mail\AuthActionMail` and the view `emails.auth-action` were missing: CI copies `app/Mail` and `resources/views`, and `setup.sh` copies neither.
  - After matching CI exactly, the previously failing classes passed (55 + 24 tests), and the final full run above is clean.
  - The `setup.sh` gap is recorded as backlog. It is outside this slice and was not changed.
- `web`: `npx tsc --noEmit` reports 48 errors, all pre-existing in test files. The count is identical with this change stashed, and none are in files this PR touches. Web CI runs `npm test` + `npm run build`, and both pass. `npm run lint` is not configured in this repo (it opens an interactive ESLint setup), so it was not run.
- PostgreSQL was not run locally. CI runs it.

## CI

To be observed on the PR head (php sqlite + pgsql, CI Gate, web-ci, storefront-ci).

## Pre-merge review

- PRE_MERGE_REVIEW: pending CI on the final head
- Reviewed Head SHA: recorded on the PR

## Merge

**Not merged.** Requires explicit owner approval.

## Self-review

### Implementer

All fixture expectations were written by hand from the contract, not generated from the code. PHP and both TS twins pass them unchanged on the first run, and key order and idempotency are asserted.

### Reviewer

- The colour block in the resolver was simplified during review.
- Biome's import-order and formatting fixes were applied to the new files only, and the twins were re-synced afterwards. A byte-identity test guards them.
- The PHP/TS closed lists, including the 52 icon keys, are cross-checked by parsing the PHP sources from vitest.
- A PHP test inside the `setup.sh` app cannot read the TS files, which is why the check runs from vitest.

### AWJ Guardian

- No accounting, tax, inventory, order, tenant, branch, RBAC or persistence change.
- No HTML, CSS, SVG or URL can enter a visual document: allow-listed keys, closed enums, hex-only colours, and UUID media ids.
- `crop` and `rotate` are excluded per D-09.
- The append-only icon registry keeps the original 24 keys in their original positions (test-enforced).

## Accounting impact

**None.** No financial operation and no journal entry.

## Tenant / branch isolation

No models or queries. Media ownership and readiness are enforced in VD-1b and VD-1c.

## Security / authorization

No endpoints. Strict validation (`errors()`) is ready for the VD-1b write path.

## Backward compatibility

- Purely additive.
- Existing stored presentation documents and navigation, benefits and content-block icons are unaffected.
- New icon keys only widen the accepted set.

## API / DB / migration impact

**None.** This is the slice that is allowed to have none. VD-1b and VD-1c remain blocked on the separate DB/API approval.

## Risks / remaining

- Storefront dark mode remains out of scope (D-13).
- The 28 new icons appear immediately in the existing `<select>` icon pickers (navigation, benefits, content blocks). This is intended, and harmless: those pickers already list every registry key.

## Git state

- Branch: `feat/vd-1a-facet-visual-contract`
- Base SHA: `d5dfa16ec65e7b0cbb7d3adf833c54b77047208d`
- Head SHA / PR: recorded on the PR

## Recommended next dependency-ready task

After VD-1a merges, **VD-2** (shape engine + `FacetVisualTile` + `IconPicker`) is ready. It has no DB or API.

**VD-4a** (the `discovery` display contract and templates) adds optional fields to the presentation document that `store/v1/storefront` serves. That is additive, but it is a public response contract, so it is **held for the owner's confirmation**, together with VD-1b and VD-1c (migration and API).
