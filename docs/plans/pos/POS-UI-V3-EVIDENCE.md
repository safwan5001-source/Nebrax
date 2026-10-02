# POS-UI-V3-EVIDENCE — Current-main implementation map

**Horizon:** AWJ POS UI V3  
**Task:** POS-UI-V3-EVIDENCE  
**Status:** EVIDENCE ONLY — no production code in this slice  
**Execution Base SHA:** `72a9c4e239cdca0dd90483878307eb328bdd70f4`  
**Sources read:**

- `docs/plans/pos/AWJ_POS_UI_V3_HORIZON.md` (approved execution contract)
- `docs/plans/design/AWJ_POS_UI_V3_VISUAL_DIRECTION.md` (approved visual direction)
- `docs/autonomous-engineering/AWJ-HORIZON-SYSTEM.md`

This pass inspected only the current POS presentation surface required to map V3 onto existing code. It did not re-investigate accounting, checkout authority, sessions, RBAC, or tenant isolation.

---

## 1. Current composition (what exists)

The dedicated Floor shell already exists:

- `web/src/app/(pos)/layout.tsx` sets `data-posture="floor"` on a full-viewport shell. Floor tokens (`--awj-touch-min: 44px`, `--awj-action-h: 56px`, `--awj-display-money-fs: 36px`) are already emitted under `html[data-awj-ui="3"] [data-posture="floor"]`.
- Sale state lives in `web/src/app/(pos)/pos/page.tsx` (`PosPage`, ~2515 lines). It owns cart, catalog filter, search, scanner, focus, checkout attempt, session recovery, and workspace mode. **Do not fork this state per viewport.**
- Layout constants live in `web/src/lib/pos-responsive.ts`.
- Current desktop grid is **three columns**: cart | products | category rail.

```text
POS_SALE_GRID_CLASS
  mobile: 1 col
  md:     cart minmax(280px,340px) | products
  lg:     cart 1fr | products 2fr | cats 104px
  xl:     cart 1fr | products 2fr | cats 148px
```

DOM order is cart, then products, then `catsPanel`. With `dir=rtl` the cart lands on the start (right) edge. The approved V3 diagram is the LTR mirror: catalog ~65% at the start, cart ~35% at the end. That is a presentation reorder, not a state change.

Mobile (`< md`) is already a single workspace via `mobileTab` (`products` | `cart`), plus:

- bottom nav (`POS_MOBILE_NAV_CLASS`);
- floating cart button (`POS_CART_FAB_CLASS`) — not yet the V3 sticky transaction bar, and the cart is not yet specified as a full-height transaction workspace distinct from the partial FAB flow;
- a horizontal category strip that is `lg:hidden` (the permanent rail is `lg:flex`).

Search/barcode is **inside the products panel**, not the topbar (`page.tsx` ~1524–1556). The focus manager registers that input. Moving it must keep the same ref and Enter-to-scan path.

---

## 2. Preserve (behavior and contracts)

These stay authoritative. Visual slices may recompose them; they must not rewrite them.

| Contract | Where |
|---|---|
| Checkout attempt / idempotency / recovery lock | `pos-checkout-attempt.ts`, `confirmPayment` in `page.tsx`, `PosPayment` `paying` / `checkoutPhase` |
| Tender math (cash change, non-cash cap, split order) | `lib/pos-payment-tender.ts`, consumed by `pos-payment.tsx` |
| Session lifecycle, warehouse lock, unsaved-exit guard | `page.tsx` + `PosTopbar.onReturnToSystem` |
| Scanner / HID / focus zones | `interactions/use-pos-barcode-scanner.ts`, `use-pos-focus-manager.ts`, `use-pos-keyboard-shortcuts.ts` |
| Interaction modes TOUCH / KEYBOARD_MOUSE / AUTO / HYBRID | `lib/pos-interaction-policy.ts`, `interactions/pos-input-modality.ts` |
| Variants, units, discount, price override | `page.tsx` line editors + `pos-variant-picker-dialog.tsx` + `pos-unit-change.ts` + `pos-discount.ts` |
| Favorites | local `FAV_KEY` toggle in `page.tsx` |
| Returns, exchange, receipts, cash drawer, held carts, invoice center | existing dialogs/components wired from `page.tsx` / topbar |
| Category visual decision (image/color/icon/all) | `lib/pos-category-presentation.ts` — presentation mode from POS config, not a new palette |
| Product images flag | `posCfg.show_product_images` — V3 density is an additional cashier preference, not a replacement of this server flag |
| RBAC / tenant / API | untouched. No new routes, no schema, no payment-method invention |

---

## 3. Restyle

| Surface | File | V3 change |
|---|---|---|
| Product tile | `components/pos/pos-product-tile.tsx` | Hierarchy: name, price, image, in-cart qty badge. Barcode/SKU and routine stock leave the default face; out-of-stock / low-stock stay when actionable. Keep favorite + quick-view hit targets. |
| Totals + Pay | `page.tsx` cart footer (`data-testid="pos-cart-totals"`, `pos-cart-pay`) | Stronger grand total; Pay remains the single dominant action (~56px). Discount row stays conditional. |
| Cart line face | `page.tsx` line markup inside `PosCartLineFrame` | Name, unit price, qty, line total. Not a dense admin row. |
| Payment screen chrome | `components/pos/pos-payment.tsx` | Terminal composition over the existing tender state. Same props, same `onConfirm` payload. |
| Floor surfaces | existing tokens / `data-awj-floor-*` | Light high-contrast cart. Local outcome emphasis only (`data-awj-surface="outcome"` already wraps totals). No new theme engine. No permanent dark cart. |

---

## 4. Recompose

| Surface | From | To |
|---|---|---|
| Sale grid | 3-column cart/products/rail | 2-column catalog ~65% / cart ~35% from the wide breakpoint. Catalog is one pane. |
| Topbar | Operational cluster competes with sale | Identity, **dominant search**, network, session/device, cashier, one overflow. Recent invoices, held, session, returns, exchange, drawer, warehouse stay reachable (overflow / existing shortcuts), not as equal primaries. |
| Categories | Permanent `lg+` rail + separate mobile strip | One horizontal scroll strip (All, Favorites, categories) in the catalog for every width. Overflow scroll; no second permanent rail. Reuse `renderCategoryVisual` / `resolveCategoryVisual`. |
| Selected-line editor | Always-visible unit/qty/price/discount block under the list | Keep the same handlers. Default line shows touch `− qty +`. Secondary editors (unit, discount, price override) stay on the selected line, not repeated as permanent chrome on every row. |
| Mobile cart entry | FAB + 4-item bottom nav | V3-5: sticky transaction bar (count, total, View Cart / Pay) when the cart has lines; cart opens as a full-height workspace. Bottom nav may remain only if it does not compete with the transaction bar. |
| Payment layout | `lg:grid-cols-[340px_1fr]` summary + form-like methods | ~34–38% summary / ~62–66% interaction. Amount due dominant. Method tiles. Contextual keypad (existing `show_onscreen_numeric_keypad` + `PosNumericEditor`). Paid / Remaining / Change strip. One Confirm. |

---

## 5. Missing presentation-only state

No server or schema state is missing.

Add only client presentation state:

1. **Density mode** `compact | standard | visual`, default `standard`, persisted in `localStorage` (cashier preference, same class as favorites). Does not change `show_product_images` from the server.
   - Compact: minimal/no image, name + price.
   - Standard: balanced image when the server allows images; otherwise the compact grid with clearer type.
   - Visual: larger image treatment when images exist.
2. **In-cart quantity per product** derived from the existing cart (sum of line qty for that product id). Badge on the tile. Not a new cart field.
3. **Category overflow** is CSS scroll, not a new data model. A filter field is unnecessary while the strip scrolls; add a compact filter control only if a viewport cannot scroll the strip accessibly.
4. **Payment keypad visibility** already exists (`showOnscreenNumericKeypad` + touch policy). V3 shows it contextually for touch and collapses it for keyboard. No new tender field.

---

## 6. Test surfaces affected

Update expectations that pin the V2 grid, not the domain:

- `web/src/lib/__tests__/pos-responsive.test.ts` — exact `POS_SALE_GRID_CLASS` / category rail class.
- `web/src/app/(pos)/pos/selected-line-bar.test.ts` — same grid string.
- `web/src/components/pos/pos-product-tile.test.tsx` — barcode/stock always visible.
- `web/src/components/pos/pos-payment.test.tsx` — payment structure assertions.
- `web/src/components/pos/pos-topbar.test.tsx` — session label and overflow callbacks must keep passing.
- `web/src/components/pos/pos-cart-line-controls.test.tsx` — qty controls stay.
- Scanner/focus/interaction tests under `components/pos/interactions/` — must stay green with no contract edits unless a focus ref moves with the search field (then update the registration site only).
- `web/src/app/(pos)/pos/page.test.tsx` — smoke mount.

Do not weaken PHP POS/accounting/security tests. This Horizon should not touch `app/Services/Pos` unless a later Decision Gate says otherwise. Expected: docs and `web/**` only.

CI:

- Docs-only slices: root `CI` (php sqlite + pgsql) still runs (no path filter).
- `web/**` slices: `Web CI` (`web-ci.yml`: vitest + `npm run build`).
- Storefront / mobile workflows are path-filtered and are not part of this Horizon unless a slice touches those trees (it must not).

---

## 7. Likely files per slice

### POS-UI-V3-1 — shell, topbar, 65/35

- `web/src/lib/pos-responsive.ts`
- `web/src/lib/__tests__/pos-responsive.test.ts`
- `web/src/app/(pos)/pos/selected-line-bar.test.ts`
- `web/src/app/(pos)/pos/page.tsx` (grid children: catalog pane wraps products + temporary rail; search slot moves toward the topbar)
- `web/src/components/pos/pos-topbar.tsx`
- `web/src/components/pos/pos-topbar.test.tsx`
- report: `docs/plans/pos/POS-UI-V3-1-IMPLEMENTATION-REPORT.md`

Search input stays one element registered with the focus manager. Category rail may still render inside the catalog pane in this slice; V3-2 removes it as a permanent column.

### POS-UI-V3-2 — catalog

- `web/src/components/pos/pos-product-tile.tsx` + test
- `web/src/lib/pos-responsive.ts` (density grid classes)
- new small helper `web/src/lib/pos-density.ts` (+ test) for the preference parse/default
- `web/src/app/(pos)/pos/page.tsx` (one horizontal category strip; density switch; in-cart badge)
- `web/src/lib/pos-category-presentation.ts` reused, not rewritten
- report: `docs/plans/pos/POS-UI-V3-2-IMPLEMENTATION-REPORT.md`

### POS-UI-V3-3 — cart

- `web/src/app/(pos)/pos/page.tsx` cart line + totals
- `web/src/components/pos/pos-cart-line-controls.tsx` (touch `− qty +` on the line; selected-line secondary editors unchanged in behavior)
- existing selected-line tests
- report: `docs/plans/pos/POS-UI-V3-3-IMPLEMENTATION-REPORT.md`

### POS-UI-V3-4 — payment

- `web/src/components/pos/pos-payment.tsx` + `pos-payment.test.tsx`
- `web/src/components/pos/pos-numeric-editor.tsx` reused
- `web/src/lib/pos-payment-tender.ts` reused, not semantically changed
- report: `docs/plans/pos/POS-UI-V3-4-IMPLEMENTATION-REPORT.md`

### POS-UI-V3-5 — touch / responsive

- `web/src/lib/pos-responsive.ts` breakpoints:
  - `>= ~1280`: persistent split
  - `~900–1279`: split, protect cart, fewer catalog columns
  - `~600–899` and `<600`: products/cart workspaces, sticky transaction bar, full-height cart
- `page.tsx` mobile/tablet composition
- safe-area on sticky bar and Pay
- report: `docs/plans/pos/POS-UI-V3-5-IMPLEMENTATION-REPORT.md`

### POS-UI-V3-6 — QA + polish

- Fix only defects found against the V3 acceptance list.
- Evidence matrix in `docs/plans/pos/POS-UI-V3-6-IMPLEMENTATION-REPORT.md`.
- No new business behavior.

### POS-UI-V3-CLOSE

- `AWJ_POS_UI_V3_HORIZON_FINAL_REPORT.md` at repo root (Horizon §23 names this path).

---

## 8. Decision Gate

**None.**

The visual-direction document left category presentation and cart surface marked OPEN. The later approved Horizon plan closed both:

- horizontal category strip (do not keep the permanent rail);
- Light / high-contrast cart surface; outcome emphasis is local; no independent POS theme.

Those are execution decisions, not a gate.

Bounded choices this Horizon will make without stopping:

- Density preference is `localStorage` only.
- Search moves into the topbar but remains the same input and scan-on-Enter behavior.
- DOM order becomes catalog then cart so LTR matches the approved diagram and RTL mirrors it.
- Quick-amount chips stay within existing SAR cash semantics already used by payment; no new currency model.
- Portrait cart replaces the FAB entry with a full-height workspace in V3-5; until that slice, V3-1/2/3 keep the current mobile tab model so mid-horizon POS stays operable.

---

## 9. Out of scope reminder

No accounting, tax, ZATCA, inventory posting, checkout authority, session redesign, RBAC, schema, public API, delivery-platform, or production deploy changes.
