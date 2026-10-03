# AWJ-POS-UI-V3-VISUAL-VERIFY-1

STATUS: EVIDENCE CAPTURED
DATE: 2026-10-03
Base SHA: `948be9c3de4c6b6a49efd020e651ef161865255c` (`docs(pos): close AWJ POS UI V3 Horizon (#1178)`)

The POS UI V3 Horizon stays closed. This pass does not reopen a completed slice.

## Environment actually used

- Local Next.js dev server on `http://127.0.0.1:3001`, demo session (`localStorage` demo user). Not production and not a signed-in cashier tenant.
- Playwright Chromium 151.0.7922.34, headless, device scale 1, `fullPage: false`.
- Spec: `web/e2e/pos-ui-v3-visual-verify.spec.ts`.
- Result: 1 passed, about 3 minutes, after the payment-amount fix below.
- One browser context was reused, so the demo cart grew across shots. Counts in later shots are not a fresh sale.
- Next.js dev overlay (`N 3 Issues`) is on every shot. It comes from a pre-existing `INVALID_KEY` for dotted next-intl keys (`cart.itemCount` and others). It is not a POS product control. It does cover the bottom-left corner in this environment.

## Screenshots actually captured

Directory: `docs/visual-qa/pos-ui-v3-verify/`.

| File | Viewport | Locale | Theme | Workspace |
|---|---|---|---|---|
| `390-ar-light-products.png` | 390×844 | ar | light | products |
| `390-ar-dark-products.png` | 390×844 | ar | dark | products |
| `390-en-light-products.png` | 390×844 | en | light | products |
| `390-ar-light-cart.png` | 390×844 | ar | light | cart |
| `390-ar-light-payment.png` | 390×844 | ar | light | payment |
| `430-ar-light-products.png` | 430×932 | ar | light | products |
| `430-en-dark-cart.png` | 430×932 | en | dark | cart |
| `tablet-portrait-ar-light-products.png` | 768×1024 | ar | light | products |
| `tablet-portrait-ar-light-cart.png` | 768×1024 | ar | light | cart |
| `ipad-landscape-ar-light-products.png` | 1180×820 | ar | light | products |
| `ipad-landscape-en-dark-payment.png` | 1180×820 | en | dark | payment |
| `1024-ar-light-products.png` | 1024×768 | ar | light | products |
| `1024-en-light-cart.png` | 1024×768 | en | light | cart |
| `1440-ar-light-products.png` | 1440×900 | ar | light | products |
| `1440-ar-dark-products.png` | 1440×900 | ar | dark | products |
| `1440-en-light-products.png` | 1440×900 | en | light | products |
| `1440-en-dark-payment.png` | 1440×900 | en | dark | payment |
| `1440-ar-light-search.png` | 1440×900 | ar | light | search `حبر` |
| `1440-ar-light-keyboard-wedge.png` | 1440×900 | ar | light | keyboard wedge |
| `1440-ar-light-qty.png` | 1440×900 | ar | light | quantity |
| `1440-ar-light-payment-amounts.png` | 1440×900 | ar | light | payment amounts |

`measurements.json` is the machine reading for the same run. Document overflow was 0 on every captured shot. `dir` matched the locale. `dark` matched the theme.

## Matrix

PASS means a screenshot was taken and document overflow was 0. A cell that was not opened is NOT RUN. This is not a claim that every untested combination would pass.

| Check | 390 | 430 | 768×1024 portrait | 1180×820 iPad landscape | 1024×768 | 1440×900 |
|---|---|---|---|---|---|---|
| Arabic RTL products | PASS | PASS | PASS | PASS | PASS | PASS |
| English LTR products | PASS | NOT RUN | NOT RUN | NOT RUN | NOT RUN | PASS |
| Light | PASS | PASS | PASS | PASS | PASS | PASS |
| Dark | PASS (ar products) | PASS (en cart) | NOT RUN | PASS (en payment) | NOT RUN | PASS (ar products, en payment) |
| Cart workspace | PASS ar light | PASS en dark | PASS ar light | NOT RUN | PASS en light | seen beside products from 900px |
| Payment workspace | PASS ar light | NOT RUN | NOT RUN | PASS en dark | NOT RUN | PASS en dark and ar amounts |
| Horizontal page overflow | PASS 0px | PASS 0px | PASS 0px | PASS 0px | PASS 0px | PASS 0px |

## Interaction results

| Check | Result |
|---|---|
| Product search | PASS at 1440 ar light. Typing `حبر` left the laser-ink tile. |
| Barcode field | Same search input. PASS as a focused field (F4 focused it; the spec asserted `document.activeElement`). |
| HID scanner hardware | NOT RUN. No physical scanner was attached. |
| Keyboard wedge | PASS. Typed `2000000000003` (demo barcode for SKU-003) and Enter. The cart line count increased. This is software keyboard input, not a HID device. |
| Keyboard shortcuts | PASS for F4 focus. Shortcut footer was visible at 1024 and 1440. A full F2/F6/F8/F9 sweep was NOT RUN in this pass. |
| Cart quantity | PASS. Increase control box was at least 44×44. The shot shows the line quantity and the selected-line quantity on the same path. |
| Totals | PASS. Subtotal, zero discount, tax, and grand total were readable on cart shots. |
| Remaining / change | PASS after the fix. At 1440, received `5000` produced remaining `0.00` and change `2,590.75`, and Confirm was enabled. At 390, remaining showed `575.00` instead of the earlier clipped `..75.00`. |
| Payment confirmation click | NOT RUN. Confirm was visible and enabled at 1440 and 1180. The sale was not submitted. |
| Touch targets | PASS for the measured 390 transaction-bar Pay: 55×56. Quantity increase was at least 44px. Method tiles and Confirm are `min-h-14` in source and were fully visible at 1180 and 1440. |
| Safe area | NOT RUN on a notched device. Chromium reported `padding-bottom: 8px` on the transaction bar (`max(0.5rem, env(safe-area-inset-bottom))` with a zero inset). |
| Browser zoom other than 100% | NOT RUN. |
| Real phone / tablet hardware | NOT RUN. These are Chromium viewport sizes only. |

## Findings

### Fixed in this change — major

At 390×844 the payment remaining amount used `truncate` with `text-2xl` inside a three-column row. The captured amount was `..75.00` while the invoice total on the same screen was `575.00`. Hover `title` was the only full value, which is not an acceptable cashier state.

Fix, presentation only: drop `truncate` on Paid / Remaining / Change, keep the three columns, and use `text-base` below `sm` with `sm:text-2xl` when that figure is the dominant one. A re-run shows `575.00` in full. Tender math, confirm lock, and the payload were not changed. `pos-payment.test.tsx`: 13 passed.

### Open — major

The global “previous cart restored” toast sits on the bottom edge and covers the phone payment footer and part of Pay / the shortcut row until it is dismissed. The dev overlay also covers the bottom-left in this environment, so a production-only screenshot was not taken. No toast-position change was made. Checkout behavior was not changed.

### Open — minor

At 390×844 English LTR the topbar search placeholder is clipped to about “Se”. The search icon remains, and the same field is complete at 1440. Not changed.

Demo product names stay Arabic in the English locale. That is catalog data, not a layout failure.

## Fix PR

This report and the payment-amount fix are the same change. No other POS refactor.

## Remaining manual / device verification

- Physical HID scanner.
- A notched phone safe-area inset.
- Browser zoom above 100%.
- A real cashier session, not demo mode.
- The toast-over-Confirm overlap without the Next.js dev overlay.
- The combinations marked NOT RUN in the matrix.

## Production

Not deployed.
