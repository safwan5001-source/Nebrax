# AWJ-VD-2 — Implementation Report (Shape engine, FacetVisualTile, IconPicker)

STATUS: **PR-READY — in review, not merged** (merge needs explicit owner approval, D-14)
DATE: 2026-10-14
HORIZON: AWJ-COMMERCE-VISUAL-DIMENSIONS-H1 · slice VD-2 (H1-2)
AUTHORITY: G0 closed by the owner (D-01..D-17 approved). VD-1a merged as `8801af9` (post-merge CI green). VD-2 has no DB or API change, so it continues the horizon without the separate DB/API approval that VD-1b, VD-1c and VD-4a still need.

## Outcome

The **render layer** for facet visuals, shared by the admin preview and the storefront:

1. **Shape engine** (`facet-visual-style.ts`, byte-identical twins): geometry for the 12 closed shapes, the three sizes, CSS-only framing (fit, focal point, zoom), and the icon-colour contrast guard.
2. **`FacetVisualTile`** (storefront component + admin preview twin): draws one resolved visual with the image → icon → text fallback, keeping the resolved shape and size.
3. **`IconPicker`** (admin): a searchable, accessible grid over the curated `IconRegistry`, emitting a key only.
4. **One contract refinement** (PHP + both TS twins + shared fixture): the resolver now emits `fallbackIcon` with image content (see below).

**Not touched:** database, migrations, API routes, controllers, services, stored documents. Nothing is mounted in a live screen yet. VD-3 mounts the tile and picker in the editor, and VD-4b mounts the tile in the storefront sections.

## Contract refinement — `fallbackIcon`

The D-08 render fallback is image → icon → text, but an image can fail **at load time**, after resolution. A VD-1a resolved visual with `content: "image"` did not carry the icon, so the renderer had nothing to fall back to.

- When `content` is `image` and an icon resolves on its chain (value → facet defaults), the resolved visual now carries `fallbackIcon`.
- `iconColor` is emitted when `content` is `icon` **or** a `fallbackIcon` is present.
- Key order: `content, image, fallbackIcon, icon, iconColor, background, shape, size, showLabel`.
- Additive: no stored document changes; `content`, `sources` and every other key are unchanged.
- Shared fixture: the governing example now expects `fallbackIcon: "gift"`, and a new case covers an image carrying its fallback icon and that icon's colour. PHP, web and storefront pass the same fixture.

## Approach

| Piece | Decision | Why |
|---|---|---|
| Simple shapes (circle, square, rounded, landscape, portrait, oval) | `border-radius` + `aspect-ratio` | Cheapest, crisp at any size. |
| Star, diamond, hexagon | `clip-path: polygon(…%)` | Percentages only, so responsive. Baseline since 2020. |
| Heart, vase, Islamic arch | SVG `mask-image` **data URI**, `mask-size: 100% 100%`, plus `-webkit-` props | Responsive and needs **no DOM ids**: SSR-safe and correct with any number of tiles per page. |
| Rejected | `clip-path: path()` (fixed coordinates, does not scale) · `shape()` (Baseline low) · inline `<clipPath clipPathUnits="objectBoundingBox">` | The last needs a unique id per tile, which conflicts with SSR and repeated tiles. |
| Image framing | `object-fit` + `object-position` + `transform: scale()` with matching origin | D-09: one original, no crop, nothing baked. |
| Geometry ownership | Code constants; documents carry only the shape key | No merchant input can reach CSS or SVG. A test pins mask paths to plain path commands. |
| RTL | All shapes are horizontally symmetric | No mirroring needed; verified in RTL and LTR screenshots. |
| Icon colour | WCAG 2.2 SC 1.4.11 non-text contrast ≥ 3:1 against an explicit background; an unreadable or invalid colour falls back to `--store-primary` | The merchant cannot make an icon invisible. |

**Deviation from the task-queue wording:** the queue named "SVG objectBoundingBox" and `@supports`. The mask data URI replaces `objectBoundingBox` for the reason above. No `@supports` guard is used because `mask-image` and `clip-path: polygon()` are Baseline widely available, and the `-webkit-` mask props cover older Safari and Chromium. A browser that ignored the mask would still show an unbroken rectangular frame, not a broken tile.

### `FacetVisualTile` behaviour

- The shape frames the media only; the tile has no card (cards belong to the section layout, VD-4).
- **Never a broken image:** no source, or a load error, falls back to `fallbackIcon` and then to text, keeping the shape and size.
- **Accessibility:**
  - The frame is `aria-hidden`; the image is decorative (`alt=""`) because the name is always present.
  - A hidden label stays in the DOM as `sr-only`.
  - When nothing visual is left to draw, the label is shown regardless of `showLabel`.
- **Performance:** `loading="lazy"`, `decoding="async"`, explicit `width`/`height` plus `aspect-ratio` (no layout shift), and `srcSet`/`sizes` passthrough.
- **Not a link:** the section renderer wraps it, so filtering keeps the existing `facet[key]=slug` URLs.
- **Defensive:** an icon key outside the registry draws nothing (no empty frame, no markup).
- **Tokens only, no raw hex:** the frame uses `--store-muted → --store-surface-muted → transparent`, and the icon uses `--store-primary → currentColor`. The admin drift ratchet (`drift-ratchet.test.ts`) caught the first draft's hex fallbacks, and they were removed from both twins.

### `IconPicker` behaviour

- A grid of 44px buttons (`size-11`) with `aria-pressed` and the localized name as `aria-label` and `title`.
- Search matches the key, the Arabic and English labels and the tags. All words must match, and Arabic diacritics and case are ignored («تَخرّج» finds «تخرّج»).
- An optional "no icon" choice (`allowNone`), a `disabled` read-only state (for VD-3's permission handling, D-04), and an empty-results message.
- Icons are drawn bare; the selection uses the semantic `primary` / `primary-soft` tokens (DESIGN_SYSTEM.md).

## Changed files

**New:**
- `storefront/src/lib/presentation/facet-visual-style.ts`
- `web/src/modules/store-experience-builder/presentation/facet-visual-style.ts` (byte-identical twin)
- `storefront/src/components/ui/facet-visual-tile.tsx`
- `web/src/modules/store-experience-builder/FacetVisualTile.tsx` (twin; body identical from `export function`, test-enforced)
- `web/src/modules/store-experience-builder/IconPicker.tsx`
- Tests:
  - `storefront/src/lib/presentation/__tests__/facet-visual-style.test.ts` (8)
  - `storefront/src/components/ui/__tests__/facet-visual-tile.test.tsx` (7)
  - `web/src/modules/store-experience-builder/__tests__/icon-picker.test.tsx` (9)
  - `web/src/modules/store-experience-builder/__tests__/facet-visual-tile.test.tsx` (2: twin mirror + preview behaviour)
- `docs/plans/store/visual-dimensions/AWJ-VD-2-IMPLEMENTATION-REPORT.md`

**Modified:**
- `app/Support/Commerce/CommerceFacetVisualResolver.php` (`fallbackIcon`)
- `storefront/src/lib/presentation/facet-visual.ts`
- `web/src/modules/store-experience-builder/presentation/facet-visual.ts` (twins, `fallbackIcon`)
- `tests/Fixtures/presentation/facet-visual-inheritance.json` (governing example updated + 1 new case)
- `web/src/modules/store-experience-builder/__tests__/facet-visual.test.ts` (twin identity now also covers `facet-visual-style.ts`)
- Horizon state: `AWJ-VD-H1-TASK-QUEUE.md`

## Tests and exact results (local)

| Suite | Command | Result |
|---|---|---|
| PHP focused | `php artisan test --filter=CommerceFacetVisualContractTest` | **12 passed** |
| PHP full | `php artisan test --parallel` (SQLite; `setup.sh` now at CI parity since `cf58c96`) | **OK — 6908 tests, 51884 assertions, 0 failures, 95 skipped** |
| Storefront full | `pnpm test` | **199 files passed / 15 skipped; 2540 tests passed / 15 skipped** |
| Storefront static | `pnpm check` (Biome) · `pnpm check:locales` · `npx tsc --noEmit` | Biome 0 errors (2 warnings + 2 infos, pre-existing in files this PR does not touch) · locales in sync · tsc exit 0 |
| Web full | `npm run test` (merged head) | **607 files / 6643 tests passed** (includes the semantic-token drift ratchet) |
| Web build | `npm run build` (merged head) | **Compiled successfully; 189/189 static pages** |

**Notes:**
- `web`: `npx tsc --noEmit` reports errors only in pre-existing test files (none touched by this PR). Web CI runs `npm test` + `npm run build`. `npm run lint` is not configured in this repo (it opens an interactive ESLint setup).
- The branch merged `origin/main` at `f1bcc67` (web and docs only). PHP and storefront results were taken before that merge, and the merge touches neither.
- PostgreSQL was not run locally. CI runs it; this slice has no SQL.

## Visual verification

A throwaway SSR harness (not committed) rendered every shape as an image tile and an icon tile, plus edge states, and Playwright (Chromium) captured RTL and LTR at 1280px and 390px:

- All 12 shapes render correctly as image and icon tiles, at every size, with no stretching and no horizontal overflow (`scrollWidth ≤ clientWidth` at both widths).
- Long Arabic labels clamp to two lines. The hidden-label hexagon keeps its name as `sr-only`. An unreadable merchant colour falls back to the theme primary. Vase sm/md/lg render with focal point and zoom.
- **Known screenshot limit:** the "broken image" tile shows an empty arch frame in the static capture because the harness does not hydrate, so `onError` never runs. The fallback to the icon is verified by unit tests in both apps (`fireEvent.error` → icon drawn, shape and size kept).
- The `IconPicker` is verified by unit tests (roles, names, `aria-pressed`, 44px, search, read-only). Its light/dark visual check happens in VD-3, where it is mounted in the real editor shell; it uses only semantic tokens.

## Self-review

### Implementer

- The twins are enforced by tests: `facet-visual-style.ts` byte-identical, and the tile body identical from `export function FacetVisualTile`. Only imports, the docblock and the lint-ignore line differ.
- Geometry keys follow `FACET_VISUAL_SHAPES` order exactly (test-enforced).

### Reviewer

- **Fixed:** raw hex CSS fallbacks in the tile, which broke the admin drift ratchet. Both twins now use tokens only.
- **Fixed during development:**
  - geometry key order;
  - leaked React renders in web tests (`afterEach(cleanup)`);
  - an unknown icon key drawing an empty frame (now `normalizeIconKey`).
- **Residual, by design:** `readableIconColor` checks contrast only against an **explicit** merchant background. With no background, the frame uses the theme token, whose value is only known at render time. VD-4b's browser checks (VD-5) cover theme surfaces.

### AWJ Guardian

- No accounting, tax, inventory, order, tenant, branch, RBAC or persistence change.
- No merchant string reaches CSS or SVG: shape keys index code constants, colours are validated `#rrggbb` (VD-1a), and icon keys go through the registry.

## Accounting impact

**None.** No financial operation and no journal entry.

## Tenant / branch isolation

No models, queries or endpoints. Media ownership remains VD-1b/VD-1c.

## Security / authorization

No endpoints. The picker's `disabled` state is the hook for VD-3's "no `commerce.manage` → read-only with reason" (D-04); the server remains the authority.

## Backward compatibility

- Additive: a new optional key in the resolved (not stored) visual, plus new components not yet mounted anywhere.
- No existing screen changes.

## API / DB / migration impact

**None.**

## Risks / remaining

- Storefront dark mode remains out of scope (D-13).
- The `fallbackIcon` refinement is a small contract addition beyond the VD-1a text. It is surfaced here for the owner rather than applied silently.

## Git state

- Branch: `feat/vd-2-facet-shape-engine`
- Base: `8801af9` (VD-1a), with `origin/main` merged at `f1bcc67`
- Head SHA / PR: recorded on the PR

## Recommended next dependency-ready task

The remaining dependency-ready slices all need the owner's **separate** approval:

- **VD-1b** (migration + admin API) and **VD-4a** (optional `discovery` fields in the public `store/v1/storefront` document).
- VD-3 needs VD-1b + VD-2, and VD-4b needs VD-1c + VD-2 + VD-4a.

With VD-2 in review, **the horizon is paused at the DB/API approval gate.**
