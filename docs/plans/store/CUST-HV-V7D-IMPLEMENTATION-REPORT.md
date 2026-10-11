# CUST-HV V7d — Navigation model, icon registry and rendering — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V7d (1–3 of 4)** — V7c ✔ → **V7d-1 icon registry · V7d-2 navigation document · V7d-3 storefront + Canvas rendering** → V7d-4 navigation editor (own PR) → V7e footer. |
| **Branch** | `cust-hv/v7d-navigation` (from `main` after V7c-2 #1296) |
| **Authority** | V0 §11.1 (schema) · §11.3 (rendering, a11y, parity rule) · §11.4 (icon registry, D-22) · §2.2 (additive) |
| **Scope** | Two additive optional keys' worth of model (`navigation` document; icon registry as a code-owned constant) and their rendering. No migration, no endpoint, no publish-gate change, `PRESENTATION_CONFIG_VERSION` stays 3, no accounting effect. The merchant **editor** is V7d-4 (separate PR): until it ships a document can only arrive through the API, and an absent document is byte-identical to today. |

## AWJ Decisions recorded here (what V0 left open — not contract changes)

| Question | Decision | Why |
|---|---|---|
| Icon registry shape | 24 append-only keys, `ICON_KEYS` pinned in order; `normalizeIconKey` fail-closed (unknown → nothing drawn); `directional` flag (only `truck`) mirrors under RTL; labels AR/EN + search tags for the picker. PHP `IconRegistry::KEYS` is the authority; the TS list is test-pinned against it. | D-22: no SVG upload, stable keys. |
| Does a stored `main` menu with zero items supersede `header.links`? | **Yes** — literal V0 §11.1 ("has a menu with `id: 'main'`"). The empty draft menu is kept by the normaliser so an emptied menu stays emptied; the legacy list never resurrects. | A merchant who deletes every item means "no links". |
| Parent item with children | The label stays a **real link** to the parent's target; a separate chevron button is the disclosure (`aria-expanded` / `aria-controls`). | Keyboard and touch users can both go to the parent *and* open its children; no hover-only access (§11.3). |
| Dropdown vs link presentation | Only `presentation.kind = "dropdown"` **with ≥ 1 live child** is a disclosure. A `link` parent keeps its children as data but renders as a plain link; a dropdown whose children all vanished (deleted category…) degrades to a plain link. | Never a dead disclosure. |
| Deleted / unknown targets | The resolver is pure over a context built from the live catalogue; an absent category / product / unserved content page **omits the item** (children included when it is a child). Reads fail closed (a failed catalogue read leaves the map empty). | V0 §11.1: "never a dead link". |
| Content targets | Stored slugs are the seven `CONTENT_PAGE_SLUGS`, but the storefront serves only the four policies (`/policies/<slug>`) and `contact` (`/#contact`) today. `about` / `faq` are **omitted** at render (and in the Canvas), not pointed at a 404; `SERVED_CONTENT_SLUGS` (shared twin) is the single source, so the V7d-4 picker can mark them unavailable. | "Don't invent capability" (`DESIGN_ONLY` / `GATED`). |
| Product targets | Verified through one batched read (`fetchProductsByIds`), **≤ 8 product targets per menu** in document order (the backend rejects a longer list); further product items are omitted. Category ids resolve through the full category tree. | Bounded, one request; the catalogue's permalink/slug *is* the entity id today. |
| Where the desktop menu lives | Same slot the legacy extra links used (identity-row actions, from `lg`), now one `<nav aria-label="Main menu">`; the top-level link keeps `data-extra-nav`. | No layout change for a header with plain links; the V7a–V7c proofs keep their anchors. |
| Mobile | Every enabled item of `main` renders in the menu sheet below `lg` (the DEF-1 parity rule); items with children are an accordion (≥ 44 px toggle). | §11.3. |
| Badges | `brand` / `accent` tone pairs only (`bg-store-primary`/`-foreground`, `bg-store-accent`/`-foreground` — the pairs the product cards already rely on); text ≤ 12. | Closed, contrast-safe by the theme. |
| Hover | Mouse pointers only (touch never opens by hover); a click that follows a hover-open **pins** it open instead of toggling it shut; 120 ms close delay; focus leaving the whole item closes it. | A hover-then-click that closed the menu was caught by the Chromium proof design review and fixed (jsdom test). |
| Mega menu | Rejected at normalisation (`mega` is reserved, not accepted). | V0: reserved for LATER. |

## What was built

- **Icon registry (V7d-1)**: `icon-registry.ts` twins (keys, labels, tags, `directional`), `StoreIcon` (storefront: lucide glyph map; Canvas twin), PHP `IconRegistry`.
- **Navigation document (V7d-2)**: PHP `StorefrontNavigationNormalizer` (authority) + byte-identical TS twins `navigation.ts`; limits 6 menus / 24 items / 12 children / depth 1; typed `NavTarget` (home · category · product · content · external https with `newTab`); ids sanitised and de-duplicated deterministically (`a`, `a-2`, `a-3`, 64-char safe); labels cut at 80, items without a valid target dropped, a legacy free `href` is **not** a target; `badge` ≤ 12 / tone closed; `presentation` link|dropdown; wired into `StorefrontPresentationNormalizer` and both `config.ts` twins. Shared fixture `tests/Fixtures/presentation/navigation.json` (22 cases).
- **Resolver + data (V7d-3)**: `navigation-resolve.ts` (pure: `navTargetHref`, `resolveNavMenu`, `collectNavTargetIds`) and `public-navigation.ts` (`publishedMainNav`: reads only what the menu targets); `(storefront)/layout.tsx` uses `main` when present, else the legacy list.
- **Storefront UI**: `HeaderNavLinks` (client; disclosure + roving focus), `MobileNavItem` (accordion), `NavItemContent` (icon · label · badge), `MobileMenu` / `Header` wiring; messages (`mainMenu`, `showSubmenu`, `hideSubmenu`) in all six locales.
- **Canvas**: `CanvasNav` draws the same items (disabled / label-less / unserved-content omitted exactly like the storefront; dropdown opens on hover / focus-within; `start-0` logical alignment); the rail clips on the x axis only so a panel is not cut.

## Backward compatibility

Absent `navigation` ⇒ no key, legacy `header.links` render exactly as before (pinned by PHP, both TS twins, Canvas and `Header` tests). Every V7a–V7c proof's anchor (`data-extra-nav`, `data-mobile-extra-nav`) is preserved. Old published versions are untouched.

## Design Quality Pass — real Chromium

`scripts/nav-proof/` mounts the **production** `HeaderNavLinks` / `MobileNavItem` (esbuild bundle, real AR/EN messages) into the **production** `Header` markup painted with the compiled storefront stylesheet. 2 pages (AR RTL / EN LTR) × 6 viewports (390 / 430 / 768 / 1024 / 1280 / 1440): **210 checks, 0 violations**.

- ≥ `lg`: nav visible, 3 top-level links in the correct (RTL-mirrored) order; panel closed and absent before opening; **ArrowDown** opens and focuses the first child; arrows rove and wrap, Home/End; **Escape** closes and returns focus to the chevron; click opens; Tab away closes; a real mouse hover opens and leaving closes; the panel's inline-start edge equals the parent's (left in LTR, right in RTL) and stays inside the viewport; hit-test proves it paints over the page; opening does not change the header height; the new-tab child carries `rel="noopener noreferrer"`; icons are `aria-hidden`; `brand` and `accent` badge contrast ≥ 4.5:1; no horizontal overflow before/after.
- < `lg`: desktop nav not shown; accordion closed initially, toggle ≥ 44 × 44, children indented on the **logical** start side, rows ≥ 40 px, nothing leaves the viewport, closes again.
- **Negative controls** (both caught): `--strip` (panel loses `position: absolute`) → 6 violations; `--physical` (`start-0` becomes a physical `left:0`) → 3 violations, all RTL.
- Screenshots: `docs/plans/store/cust-hv-v7d/nav-{desktop,mobile}-{ltr,rtl}.png` (dropdown open by keyboard; accordion open).

Not Chromium-proven in this PR (stated): the editor (V7d-4) and a live Canvas e2e of the rail dropdown (jsdom-covered; the Canvas uses the same logical classes).

## Tests

PHP `StorefrontNavigationTest` (shared fixture × both entry points, absent ⇒ identical + version 3, legacy links untouched, external URLs through the shared sanitiser, 24-key registry); storefront / web `navigation.test.ts` (fixture × `normalizeNavigation` and `normalizePresentationConfig`, `mainMenu`, PHP↔TS icon-key pin read from `IconRegistry.php`), `icon-registry` tests, `navigation-resolve.test.ts` (every target kind, deleted target, unserved content, dropdown degradation, product cap), `HeaderNavLinks.test.tsx` (disclosure a11y, roving focus, Escape, blur, hover vs touch, badge/icon, rel), `MobileNavItem.test.tsx`, Canvas `navigation.canvas.test.tsx`; twin byte-identity list extended (`icon-registry.ts`, `navigation.ts`); `Header` mounts the nav only when links exist.

## Limitations (stated)

- No merchant editor yet (V7d-4).
- `about` / `faq` content targets are valid in the document but not rendered until the storefront serves those routes.
- Product targets beyond 8 per menu are omitted.
- A parent whose own target is dead is omitted together with its children (no target-less trigger); revisit if the editor needs it.
- `mega` panels, per-item icons on the footer and CTA icons remain deferred (V7e / V9).

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: **untouched** — the document rides the existing presentation payload and its normalisers; the storefront reads only the public category / product endpoints it already used, scoped to the ids a Published menu names. External URLs go through the same https sanitiser; no raw internal paths are stored. No arbitrary CSS/JS/HTML, no free positioning. No journal entry, no accounting behaviour.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
