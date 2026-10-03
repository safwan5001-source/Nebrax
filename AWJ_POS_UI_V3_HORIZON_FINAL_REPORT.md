# AWJ POS UI V3 — Horizon Final Report

STATUS: CLOSED — pending this close slice's own merge
DATE: 2026-10-03
Execution Base SHA: `72a9c4e239cdca0dd90483878307eb328bdd70f4`
Close started from: `675749c6d16f7d9a1c9c80fc01a31d05b2d9c087`

## Horizon objective

Deliver the AWJ POS UI V3 cashier Floor over the existing POS foundation: shell, catalog, cart, payment, and responsive composition, without changing accounting, checkout, session, inventory, RBAC, or tenant isolation.

The Horizon is closed as a presentation program. A live browser matrix was not observed and is recorded as a limitation, not as a silent pass.

## PRs and Merge SHAs

| Slice | PR | Reviewed Head | Merge SHA | POST_MERGE |
|---|---|---|---|---|
| POS-UI-V3-EVIDENCE | [#1166](https://github.com/safwan5001-source/Nebrax/pull/1166) | `57b952e74af93d960e3e03429263ec58b9b4a9de` | `d9942a6e264bf05aadc4f005485699cd04f41844` | PASS |
| POS-UI-V3-1 shell | [#1168](https://github.com/safwan5001-source/Nebrax/pull/1168) | `c8cab2cbf986425024a871786992915c61ffc642` | `96977ab382e8defe402490ed77d3727783aa7a19` | PASS |
| POS-UI-V3-2 catalog | [#1169](https://github.com/safwan5001-source/Nebrax/pull/1169) | `9c0125f9d2786e7323173ae05750dc4ab41f8575` | `2781cd1bc360cbc68d6a5c9d0569f6bff6db22ef` | PASS |
| POS-UI-V3-3 cart | [#1170](https://github.com/safwan5001-source/Nebrax/pull/1170) | `41bb01cbddb15dcf5b947111112037a80f9f0365` | `3429ec39018479671326928ecb732294404f2878` | PASS |
| POS-UI-V3-4 payment | [#1173](https://github.com/safwan5001-source/Nebrax/pull/1173) | `4361616487b2a55c0ee88d779a3bbac300ab7383` | `557740d3fe8b0e70432b62a5ac144c1256d1a1f4` | PASS |
| POS-UI-V3-5 responsive | [#1175](https://github.com/safwan5001-source/Nebrax/pull/1175) | `687ae76bf702fc61c4530328aae5aa9172510baf` | `a9708738b707441e64fc76029e272d2ae1e58fa7` | PASS |
| POS-UI-V3-6 QA | [#1176](https://github.com/safwan5001-source/Nebrax/pull/1176) | `e18b94672f75507d7498087ff983c448aa8187d8` | `675749c6d16f7d9a1c9c80fc01a31d05b2d9c087` | PASS |
| POS-UI-V3-CLOSE | this PR | recorded in PRE_MERGE on the exact Head | recorded in POST_MERGE after squash | pending this PR |

Unrelated commits landed on `main` during the Horizon (store H4 #1167/#1172, delivery foundation #1171/#1174). They are not part of this Horizon and were not modified except by starting later slices from whatever `main` was at that time.

## Final production-code surface

No PHP, API, schema, or migration file was changed by this Horizon.

Web files touched by the implementation slices:

- `web/src/app/(pos)/pos/page.tsx`
- `web/src/app/(pos)/pos/selected-line-bar.test.ts`
- `web/src/components/pos/pos-topbar.tsx`
- `web/src/components/pos/pos-topbar.test.tsx`
- `web/src/components/pos/pos-product-tile.tsx`
- `web/src/components/pos/pos-product-tile.test.tsx`
- `web/src/components/pos/pos-payment.tsx`
- `web/src/components/pos/pos-payment.test.tsx`
- `web/src/components/pos/pos-numeric-editor.tsx`
- `web/src/lib/pos-responsive.ts`
- `web/src/lib/__tests__/pos-responsive.test.ts`
- `web/src/lib/pos-density.ts`
- `web/src/lib/pos-density.test.ts`
- `web/src/app/globals.css`
- `web/src/messages/ar.json`
- `web/src/messages/en.json`

## Final POS visual architecture

- Floor shell stays `data-posture="floor"`. No independent POS theme engine.
- Topbar: identity, the existing search/barcode input, network, session, cashier, overflow for invoices, held sales, session, returns, exchange, drawer, and warehouse.
- From 900px: catalog then cart, about 65/35. DOM order mirrors with RTL.
- One horizontal category strip (All, Favorites, categories). The permanent rail is gone. Category visuals still come from `resolveCategoryVisual`.
- Density `compact | standard | visual`, default `standard`, stored in `localStorage`. It does not replace server `show_product_images`.
- Product tile hierarchy: name, price, image when the mode and server flag allow it, in-cart quantity badge. Barcode and routine stock are not the default face. Out-of-stock and low-stock stay when actionable.
- Cart line: name, unit price, touch `− qty +` through existing `setQty`, line total. Unit, discount, and price override stay on the selected-line bar.
- Totals always show subtotal, discount, tax, and grand total. Pay is the one dominant cart action.
- Payment is a terminal workspace over the existing tender state: amount due, method tiles, one received amount, Paid / Remaining / Change, one Confirm. Tender payload and checkout lock are unchanged.
- Below 900px: products and cart are full-height workspaces. A sticky transaction bar shows count, total, and View Cart / Pay, with `safe-area-inset-bottom`.

## Screenshots and visual QA

Browser screenshots were **not captured**. POS-UI-V3-6 refused to fabricate them. The matrix below is a source-contract reading, not a visual pass.

| Viewport | Expected composition | Browser |
|---|---|---|
| ~390 phone | one workspace, transaction bar | NOT RUN |
| ~430 phone | same | NOT RUN |
| portrait tablet ~600–899 | full-height cart, bar | NOT RUN |
| ~900–1279 | 65/35 split | NOT RUN |
| 1024×768 | split, shell `overflow-hidden` | NOT RUN |
| ~1440 | split, wider catalog from `xl` | NOT RUN |

## Tests, build, and CI

Each implementation slice ran focused Vitest locally and required GitHub CI on its reviewed Head, then post-merge CI on the squash SHA. Exact run URLs are in the per-slice reports under `docs/plans/pos/POS-UI-V3-*-IMPLEMENTATION-REPORT.md`.

Latest observed production build evidence is Web CI on the V3-5 merge `a9708738b707441e64fc76029e272d2ae1e58fa7` ([37078599746](https://github.com/safwan5001-source/Nebrax/actions/runs/37078599746)). V3-6 and this close slice are documentation only, so Web CI does not run. PHP CI on the V3-6 merge succeeded: [37081812418](https://github.com/safwan5001-source/Nebrax/actions/runs/37081812418).

V3-3 post-merge pgsql hung once and succeeded on a rerun with no code change ([37068605826](https://github.com/safwan5001-source/Nebrax/actions/runs/37068605826)).

## RTL / LTR

Source uses catalog-then-cart DOM order and logical CSS (`border-s`, `ps-*`, `min-w-0`). Document direction still follows the existing locale shell.

| Language | Result |
|---|---|
| Arabic RTL | NOT RUN in a browser |
| English LTR | NOT RUN in a browser |

## Light / Dark

No POS-specific palette. Floor tokens follow the existing AWJ light/dark preference.

| Theme | Result |
|---|---|
| Light | NOT RUN in a browser |
| Dark | NOT RUN in a browser |

## Viewport matrix

See the table above. Class contracts are locked by `pos-responsive.test.ts`. Pixel overflow, clipping, and safe-area paint were not measured in a browser.

## Interaction and scanner

| Mode | Result |
|---|---|
| Touch | Quantity, Pay, Confirm, and method tiles keep large min heights in source. Not measured in a browser. |
| Keyboard / mouse | Shortcuts and focus manager remain mounted. Not re-run as a live session. |
| Hybrid | `data-interaction-mode` and the existing policy remain. |
| Scanner / HID | `usePosBarcodeScanner` and Enter-to-scan on the same search input remain. A live HID scan was NOT RUN. |
| Focus restoration | Registration moved with the search slot in V3-1. No later slice removed it. |

Hover is not the only selected state: payment methods use `aria-pressed` plus a check icon.

## Known limitations

- No signed-in cashier browser pass for the six viewports, RTL/LTR, Light/Dark, or a physical scanner.
- Line quantity exists both on the line and in the selected-line bar. That duplication keeps the POS-FINAL-1 bar.
- Split cart now starts at 900px, not 768px.

## Deferred and out of scope

Deferred:

- A later cashier-session visual QA pass with real screenshots.
- No new accounting or delivery behavior.

Out of scope, and not done:

- Accounting, tax, ZATCA, inventory posting, checkout authority, session lifecycle, RBAC, schema, public API, delivery-platform accounting.
- Production deploy and production release.

## Contracts not intentionally changed

Checkout attempt, idempotency, recovery lock, tender math, session lifecycle, tenant and branch isolation, RBAC, scanner hooks, interaction modes, variants, units, discounts, price override, returns, exchange, receipts, and cash drawer were reused. No journal-entry change. No migration.

## Production deployment state

**Not deployed.** Merge is not deploy. No production release was requested or performed.

## Recommended next Horizon

Do not open a new product Horizon from this closure.

The only follow-up that this closure itself justifies is a bounded visual QA pass on a real cashier session (six viewports, ar/en, light/dark, HID scanner), with screenshots stored as evidence. That pass needs a Decision only if it finds a defect that cannot be fixed inside presentation.
