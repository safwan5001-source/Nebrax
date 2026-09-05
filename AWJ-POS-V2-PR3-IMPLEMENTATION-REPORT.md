# AWJ POS V2 — PR-3: Cart Interaction

## Executive Summary

PR-3's approved scope was: a wider desktop cart, a clear selected-cart-line model, and
numeric-keypad-driven quantity/price/discount editing. Existing-first inspection found that
**selection, the numeric keypad, and per-line quantity/price editing already existed and were
usable** (built in PR-1/PR-2 and untouched here except for two narrow fixes). The one true gap
against the mission's explicit requirement ("Discount modes must be exactly: 1. Percentage %,
2. Fixed Amount") was that only a fixed-amount discount existed — no percentage mode. This PR
adds it as a thin, local, non-persisted UI convenience that computes an amount via existing
`setDiscount`, with **zero backend change and zero cart-schema change**.

While verifying the desktop-width requirement in a real browser, a latent, pre-existing bug was
found: widening the grid column alone had **no visible effect** — the cart panel's own
`<aside>` was not stretching to fill its flex parent, so it silently stayed content-width
(~300px) regardless of the grid track's size. This was the actual reason the cart "felt narrow"
at all these breakpoints. Fixing it (`w-full` on the `<aside>`) was necessary to satisfy the
mission's explicit, demonstrable requirement ("desktop cart is demonstrably wider") and is
documented as a discovered-and-fixed defect, not scope creep.

Also fixed: the selected-line visual highlight was previously gated behind
`policy.allowKeyboardPowerMode && keyboardActive` — i.e. invisible in AUTO/TOUCH/mouse use,
which contradicts "the UI must make the selected line unmistakable." It now reflects
`selectedLineKey === line.key` unconditionally; the underlying selection *logic* (which line is
selected, and why) was not touched.

No backend files were changed. No accounting, tax, ZATCA, stock authority, checkout, R1–R6, or
PR-2C behavior was touched.

## Existing-First Classification

| Requirement | Classification | Notes |
|---|---|---|
| Selected cart line | **Implemented, UX incomplete → fixed** | `selectedLineKey` + `PosCartLineFrame`/`usePosCartLineSelection` already existed (PR-1). Visual highlight was gated behind keyboard-power-mode only; broadened to always reflect selection. Selection *logic* unchanged. |
| Numeric keypad | **Implemented & usable** | `PosNumericEditor` (dialog + digit grid + backspace/clear/apply/cancel) already existed and is reused verbatim for quantity, price, and the new percent input. No new keypad built. |
| Quantity editing | **Implemented & usable** | `setQty`/`setQtyFromInput` unchanged; UOM/stock/audit untouched. |
| Price editing & permission | **Implemented & usable** | Gated by `posCfg.allow_unit_price_override` (server-driven POS setting) exactly as before; not touched beyond being visually unaffected by the discount changes. |
| Discount — Fixed Amount | **Implemented & usable** | Pre-existing; unchanged as the default mode and as the sole persisted representation. |
| Discount — Percentage | **Missing → implemented** | Did not exist. Added as described below. |
| Desktop cart width | **Partial → fixed** | Grid column existed (`POS_SALE_GRID_CLASS`) but the `<aside>` silently ignored it (see Executive Summary). Widened the column **and** fixed the stretch bug; verified with real pixel measurements. |
| Barcode/scanner/focus safety | **Implemented & usable, unchanged** | Not touched. The pre-existing `stopPropagation` on the price/discount row (deliberate: prevents `focusZone` from fighting focus while typing) was left exactly as-is. |
| Interaction modes (AUTO/TOUCH/KEYBOARD_MOUSE/HYBRID) | **Implemented & usable, unchanged** | Not touched; the interaction-mode subsystem itself was not modified. |
| Mobile cart/nav | **Implemented & usable, unchanged** | `md:` tier of `POS_SALE_GRID_CLASS` deliberately left untouched; only `lg:`/`xl:` widened. |
| Held/multiple carts, customer selection, session/branch context, cart recovery | **Implemented & usable, unchanged** | Not touched; confirmed via full regression run. |

## What Changed

1. **Desktop cart width** (`lg:`/`xl:` only): `POS_SALE_GRID_CLASS` cart-column `minmax()` widened;
   `<aside>` given `w-full` to actually honor the wider grid track (the real fix — see Executive
   Summary and "Desktop Cart Width" below).
2. **Selected-line visibility**: highlight condition broadened to `selectedLineKey === line.key`
   in all interaction modes (was keyboard-power-mode-only).
3. **Percentage discount mode**: new pure helper `pos-discount.ts`
   (`discountMinorFromPercent`/`discountPercentFromMinor`), a per-line `Fixed`/`%` toggle in the
   cart line, and local-only React state (`discountMode`, `percentDraft`) — **not** persisted to
   the cart snapshot/schema. Selecting `%` and typing a percentage computes the equivalent
   fixed-amount discount via the existing `setDiscount(key, amount)` path (same permission gate,
   same audit event, same clamp against the line total). Switching back to `Fixed` shows the
   already-committed amount.
4. Two new Arabic/English translation keys per locale file (`discount_mode`,
   `discount_mode_fixed`, `discount_mode_percent`).
5. Cleanup of the two new local UI-state maps on line removal and on cart clear (prevents stale
   entries from resurfacing if a line-key is reused after removal).

## Files Changed

- `web/src/lib/pos-responsive.ts` — cart column `minmax()` widened at `lg:`/`xl:` only.
- `web/src/lib/__tests__/pos-responsive.test.ts` — updated width assertions; two new tests
  (width-increase evidence, `w-full` stretch-fix guard).
- `web/src/lib/pos-discount.ts` *(new)* — pure percent↔amount conversion helpers.
- `web/src/lib/__tests__/pos-discount.test.ts` *(new)* — 6 unit tests for the above.
- `web/src/app/(pos)/pos/page.tsx` — selected-line visibility fix, `w-full` fix, discount
  mode toggle + percent input wiring, cleanup on remove/clear.
- `web/src/messages/ar.json` / `en.json` — 3 new keys each, in the existing `pos` namespace.

No backend file was changed. No new dependency was added.

## Desktop Cart Width

`POS_SALE_GRID_CLASS` (`web/src/lib/pos-responsive.ts`):

| Tier | Before | After |
|---|---|---|
| `md:` (tablet) | `minmax(280px,340px)` | **unchanged** |
| `lg:` (iPad landscape / compact desktop) | `minmax(300px,340px)` | `minmax(320px,400px)` |
| `xl:` (wide desktop) | `minmax(360px,420px)` | `minmax(400px,480px)` |

**Measured actual `<aside>` width** (Playwright, real Chromium, `getBoundingClientRect()`,
`payButton.closest('aside')`), before vs. after this PR's full diff, at fixed viewport widths:

| Viewport | Before (measured) | After (measured) |
|---|---|---|
| 900px (md) | 340px | 340px *(unchanged, by design)* |
| 1100px (lg) | 300.86px *(bug: grid track was 340/420 but `<aside>` ignored it — see below)* | **400px** |
| 1280px (xl) | 300.86px | **480px** |
| 1920px (xl) | 300.86px | **480px** |

**Root cause found and fixed**: the cart `<aside>` sits inside a plain `flex` wrapper
(`posCartPaneClass`) with no `flex-1`/`w-full` on the child, so it was sized to its own content
(~300px) regardless of how wide its parent grid column was — the grid column itself measured
correctly (verified via `getComputedStyle(...).gridTemplateColumns`), but the visible cart panel
silently ignored it. This means the pre-existing `lg:`/`xl:` `minmax()` values from PR-1/PR-2
were **already ineffective** before this PR; PR-3 both widens the column and fixes the
long-standing stretch bug that was hiding it. This is the "clear reproducible evidence" required
by the mission — before/after screenshots at 1920×1080 are available locally
(`00-BEFORE-desktop-xl-width.png` / `00-AFTER-desktop-xl-width.png`, not committed — see
"Browser QA").

Product grid area was not narrowed to compensate: its column stays `minmax(0,1fr)` and simply
absorbs slightly less leftover space (verified visually — product cards remained fully usable at
all tested breakpoints, no card-level regression).

## Selected Line Behavior

`selectedLineKey` (from `usePosCartLineSelection`, PR-1) is unchanged as the source of truth.
Only the **visual** condition changed:

```diff
- const lineSelected = policy.allowKeyboardPowerMode && keyboardActive && activeZone === 'cart' && selectedLineKey === line.key;
+ const lineSelected = selectedLineKey === line.key;
```

Verified in real browser: clicking a cart line (mouse) now shows the same highlighted state
(`border-primary bg-primary-soft`, from the pre-existing `PosCartLineFrame`) previously reserved
for keyboard-power-mode. Behavior for: selecting another line, removing the selected line,
emptying the cart, switching carts, and scanner-added lines was not changed — `PosCartLineFrame`
and `usePosCartLineSelection` themselves are untouched.

## Keypad Behavior

`PosNumericEditor` (pre-existing, PR-1/PR-2) is reused unmodified for quantity, unit price, the
existing fixed-discount input, and the new percent input. No new keypad component was built, per
the mission's explicit instruction to search for and reuse one first. Digits 0–9, decimal (where
allowed), backspace, clear, apply, and cancel all behave identically across every field that uses
it — verified in the percent input specifically (screenshot evidence below).

## Quantity Behavior

Untouched: `setQty`, `setQtyFromInput`, UOM/unit-factor handling (`pricedUnit`, `setUnit`), and
stock/server authority. No second quantity path was introduced.

## Price Editing & Permissions

Untouched. Still gated by `posCfg.allow_unit_price_override` (a server-returned POS setting);
still uses `setUnitPrice`/`normalizeUnitPrice` with the pre-existing audit event
(`price_overridden`). PR-2S's cost/profit protection is unrelated to this field and was not
touched.

## Discount Modes

Confirmed exactly two modes exist, matching the mission's requirement literally:

- **Fixed Amount** (`مبلغ`): pre-existing, unchanged, default for every line.
- **Percentage** (`٪`): new. Typing a percentage computes
  `amount = round(gross × percent / 100)` (clamped to `[0, 100]` percent and to the line's gross
  in `discountMinorFromPercent`) and commits it through the **existing** `setDiscount(key, amount)`
  — same permission gate (`posCfg.allow_discount`), same audit trail
  (`discount_changed`/`reason_code: wrong_price`), same `Math.min(gross, ...)` clamp in `lineCalc`.

**Deliberate, documented limitation**: the persisted/authoritative field remains the fixed
`PosCartLine.discount` amount — there is no persisted `discountType`. If quantity or unit price
changes *after* a percentage was entered, the amount already committed does not auto-recompute
(it behaves like a fixed amount from that point on); the cashier re-enters the percentage or
switches to Fixed to adjust it directly. Making the percentage itself the persisted, live-
recomputed source of truth would require a cart-schema/financial-semantics change, which is
explicitly out of this PR's scope per the mission's STOP conditions — documented here rather than
silently built.

Verified live (see Browser QA): 3× a 25.00 SAR item = 75.00 gross; entering `10` in percent mode
produced a 7.50 discount (10% of 75.00) exactly, shown correctly in the cart totals footer and
preserved when toggling back to Fixed.

## Scanner / Focus Verification

The pre-existing `onClick={(event) => event.stopPropagation()}` wrapper around the
price/discount row (which deliberately prevents `onSelect`'s `focusZone(...)` call from
interrupting in-progress typing) was left exactly as-is — not touched, not removed. No new modal
or popover was introduced that could capture scanner input beyond the pre-existing
`PosNumericEditor` dialog, whose open/close lifecycle is unchanged. Full regression suite
(`pos-shortcuts`, `use-pos-cart-navigation`, barcode-scanner tests) passed unmodified (see Tests).
Manual real-browser flow (add via click → select line → edit qty via keypad button → close →
click another product tile → add again) worked with no dead-focus state observed.

## Interaction Modes

Not redesigned. `usePosKeyboardActive`, `usePosKeyboardShortcuts`, `usePosFocusManager`, and the
`interaction_mode` telemetry field are all still present and untouched (guarded by the existing
`pos-responsive.test.ts` source-check test, which still passes). The one behavioral change
(selection highlight visible outside keyboard-power-mode) makes TOUCH/mouse *more* consistent
with KEYBOARD_MOUSE, not less — it does not disable or gate any mode.

## Mobile Regression Check

`md:` tier of `POS_SALE_GRID_CLASS` is byte-for-byte unchanged. Verified in real browser at
390×844 (mobile RTL): product grid, cart tab, and a line's Fixed/% toggle all render correctly
with no clipping introduced by this PR. The previously-documented, pre-existing mobile
category-strip height-clipping issue (found during the PR-2C visual QA mission, confirmed
present identically in the unmodified `image` mode before PR-2C) was not re-investigated here —
out of scope for PR-3, not touched.

## Tests

All commands run from `/home/user/Nebrax/web` unless noted; backend from
`/home/user/nibras-app`.

**Targeted (new/changed frontend)**
```
npx vitest run src/lib/__tests__/pos-discount.test.ts src/lib/__tests__/pos-responsive.test.ts
```
→ 2 files, **17 tests passed** (6 new discount-conversion tests + 11 responsive tests, including
2 new PR-3-specific ones).

**Broader POS frontend**
```
npx vitest run src/lib/__tests__/pos-discount.test.ts src/lib/__tests__/pos-responsive.test.ts src/components/pos
```
→ **28 test files, 140 tests passed** (0 failed).

**Full frontend suite**
```
npx vitest run
```
→ **229 test files, 1457 tests passed** (0 failed). Baseline before PR-3 was 228 files / 1449
tests (from PR-2C) — the +1 file / +8 tests are exactly the new/updated tests added here.

**Production build**
```
npm run build
```
→ exit code 0, no errors. (Pre-existing, unrelated TypeScript errors in
`pos/settings/configuration/page.test.tsx`, `platform/integrations/gemini-card.test.tsx`, and
`global-application-controls-card.test.tsx` were confirmed via `git stash` to exist identically
on `origin/main` before this PR — not caused by it, not touched by it.)

**Backend regression (backend untouched by PR-3 — run to demonstrate no regression, per mission
testing strategy)**
```
php artisan test --filter="PosCheckoutTest|PosProductCostVisibilityTest|PosCategoryPresentationTest|BranchIsolationGuardTest|RoleTest"
```
→ **57 tests passed** (574 assertions), SQLite. No backend file was modified in this PR, so a
second PostgreSQL run was not required (no financial/security/tenant-sensitive backend change
exists in this diff); the mission's "STOP and evaluate" gate for backend changes was never
triggered.

## Browser QA

Real Chromium (`/opt/pw-browsers/chromium`) via Playwright, against the actual Next.js dev build
and a live Laravel backend (freshly registered tenant, two real products, one POS device, one
open POS session — all created through the real `/register`, `/products`, `/pos-devices`,
`/pos-sessions/open` API endpoints, not mocked). Screenshots kept locally only (not committed),
per this repo's established convention from the PR-2C QA mission.

| # | Scenario | Result |
|---|---|---|
| 1 | Desktop RTL, light, 1920×1080, empty cart | PASS |
| 2 | Add 2 products to cart (long Arabic name + short name) | PASS |
| 3 | Select a cart line by click (mouse) — highlight visible | **PASS** (previously would have been invisible outside keyboard-power-mode) |
| 4 | Quantity + via on-screen button (1→3) | PASS |
| 5 | Discount: switch to `%`, type `10` on a 75.00 gross line → 7.50 discount computed and shown in totals | PASS |
| 5b | Switch back to `Fixed` → shows committed `7.50` | PASS |
| 5c | Remove-line flow: trash icon opens the pre-existing reason-required confirm dialog (audit requirement preserved, untouched) | PASS |
| 6 | Desktop, dark mode, 1440×900 | PASS — contrast, selection ring, and discount toggle all legible |
| 7 | Add item in dark mode | PASS |
| 8 | Mobile RTL, 390×844, product grid | PASS, no PR-3 regression |
| 9 | Mobile RTL, cart tab with item, Fixed/% toggle visible and usable | PASS |
| 10 | Desktop **LTR**, light, 1440×900 (via `locale` cookie) | PASS — full mirror, "Amount"/"%" labels translated |
| 11 | LTR: select cart line — highlight visible | PASS |
| Width | Before/after pixel measurement at 900/1100/1280/1920px (see Desktop Cart Width) | PASS — quantified |

Not captured as a separate screenshot: a very long product/category name at the exact card-
wrapping boundary, and an explicit "empty cart" shot after removal (the remove-confirm dialog's
reason-select correctly blocked my scripted removal without picking a reason, which is itself
confirmation that the pre-existing audit gate on removal was not weakened). Neither is a
functional gap; both are logged here per the mission's instruction to report anything the
environment didn't let a script fully drive, explicitly, rather than silently omit it.

## Build

`npm run build` → success, exit code 0 (see Tests for the pre-existing unrelated type-check
noise it does not affect).

## CI

No PR has been pushed at the time of writing this section (git metadata below records what will
exist after push). CI workflow results will be visible on the PR once opened; this report will
not claim results that have not run.

## Safety / Regression Review

Explicitly confirmed **not** changed by this PR (by design, and by the passing full backend +
frontend regression suites):
- Tenant Isolation, Branch Isolation — no backend touched.
- Customer eligibility (R6), tax calculation authority, ZATCA, stock authority (R1), checkout
  idempotency (R5), historical UOM/unit factor (R2), return/exchange idempotency (R4) — no
  backend touched; `PosCheckoutTest` (17 tests) green.
- Category presentation contract (PR-2C) — `PosCategoryPresentationTest` (9 tests) green,
  unrelated files untouched.
- Cost/profit protection (PR-2S) — `PosProductCostVisibilityTest` (5 tests) green; price/discount
  editing changes do not touch `purchase_price`/`avg_cost`/`profit_margin` fields at all.
- Session opening/adoption, held-cart persistence, recovery semantics — `pos-cart-snapshot`,
  `use-pos-active-carts`, `use-pos-cart-navigation` test files all green, cart schema
  (`PosCartLine`) itself unchanged (no new persisted field).
- RBAC — `RoleTest` (12 tests) green; no new permission introduced, none needed (existing
  `posCfg.allow_discount`/`allow_unit_price_override` gates reused verbatim).

## Known Issues / Deferred Items

- **Pre-existing mobile category-strip clipping** (documented first during the PR-2C visual QA
  mission): still present, still out of scope for PR-3, not touched here.
- **Percentage discount does not live-recompute** if quantity/price change after entry — see
  "Discount Modes" above; deliberate, documented, would require a financial-semantics/schema
  change outside this PR's authorized scope.
- Long-name card-wrapping and an explicit empty-cart-after-removal screenshot were not captured
  (see Browser QA) — no known functional issue, just not independently re-verified in this pass
  since PR-2's QA mission already covered card-name wrapping and this PR does not touch product
  cards.

## Risks

- The `w-full` fix changes long-standing (since PR-1) visual behavior of the cart panel at
  `lg:`/`xl:` — previously effectively fixed at ~300px regardless of tier, now genuinely
  responsive to the grid column. This is the intended fix, verified across breakpoints and in
  dark mode/RTL/LTR, but is a larger *visual* delta than the `minmax()` number change alone would
  suggest, since it makes the pre-existing width classes effective for the first time. Flagged
  explicitly for reviewer attention.
- The percent-discount UI state (`discountMode`, `percentDraft`) is per-line, in-memory only; a
  page reload while in percent-mode-with-unsaved-percent-draft will show the line back in Fixed
  mode with whatever amount was last committed (not a data-loss risk — the committed amount is
  what was always persisted — just a mode-memory reset, which is expected given it is explicitly
  non-persisted UI state).

## Remaining Work

None required for PR-3's approved scope. PR-4 through PR-8 (Invoice Center, payment/split
redesign, return/refund workspace, session reconciliation, hardware/production hardening,
mobile category-strip redesign) remain entirely untouched and are not started.

## Review Follow-up — Cart Proportion & Selected-Line Controls

Safwan/ChatGPT reviewed the first implementation (head `4c3bec9bcadcd887f31eb9ffd6189157f2d54a2d`)
and requested a narrow correction, not new scope: restore the originally-approved interaction
contract — a ~1/3-workspace cart, and a single central selected-line control bar instead of an
inline per-row editor. This section documents that correction.

### Why the first implementation was corrected

1. **Width was a fixed px target, not a proportion.** The first pass widened the cart column to
   fixed `minmax(400px,480px)`/`minmax(320px,400px)` values. That is a fixed maximum, not "≈1/3 of
   the workspace" — at very wide screens the cart would fall well short of a third; the review
   asked for a true proportion.
2. **The inline Fixed/% toggle lived inside every cart row.** That duplicated an editor per line
   and worked against AWJ's dense, compact row style — the approved UX is a single central control
   bar for the *selected* line, not a form embedded in every row.

### Exact width fix

`POS_SALE_GRID_CLASS` (`lg:`/`xl:` tiers only — `md:`/tablet and mobile untouched) changed from
fixed-px `minmax()` targets to an `fr`-based ratio, so the cart and product columns split the
**usable workspace (cart + products, excluding the fixed-width categories rail)** at a true 1:2
ratio — approximately one third to the cart, two thirds to products, at any screen width, instead
of capping out at a fixed pixel number:

```diff
- lg:grid-cols-[minmax(320px,400px)_minmax(0,1fr)_104px] xl:grid-cols-[minmax(400px,480px)_minmax(0,1fr)_148px]
+ lg:grid-cols-[minmax(280px,1fr)_minmax(0,2fr)_104px] xl:grid-cols-[minmax(320px,1fr)_minmax(0,2fr)_148px]
```

**Measured in real Chromium** (`getBoundingClientRect()` on the cart `<aside>` — the earlier
`w-full` stretch-fix remains in place and is still required for this to work):

| Viewport | Cart width | Product width | Cart % of workspace (cart+products) |
|---|---|---|---|
| 900px (md, unchanged) | 340px | remainder | n/a — proportion applies only to lg/xl |
| 1100px (lg) | 332px | 664px | 33.3% |
| 1280px (xl boundary) | 377.3px | 754.7px | 33.3% |
| 1440px (xl) | 430.7px | 861.3px | 33.3% |
| 1920px (xl) | **590.66px** | **1181.34px** | **33.33%** (measured exactly: 590.65625 / 1772 = 0.3333) |

The ratio holds constant across every tested width because it comes from the CSS grid `fr` unit
distribution, not a capped pixel value — this is what "a workspace proportion, not a fixed target"
means in the grid architecture, achieved with a one-line change to an existing constant.

### Central bottom-control-bar architecture

Removed entirely: the inline Fixed/%% toggle + two numeric inputs + per-row quantity stepper +
per-row unit-price input + per-row delete icon that the first pass had rendered inside every cart
line (~110 lines of duplicated-per-row JSX).

Added: one compact control bar rendered once, directly below the cart-lines list, operating
exclusively on `cart.find(l => l.key === selectedLineKey)` — **no new selection state**, the
existing `selectedLineKey`/`setSelectedLineKey` (PR-1, `usePosCartLineSelection`) remains the only
source of truth. Layout (RTL, so visually right-to-left: **حذف | الخصم ▼ | (السعر إن مفعّل) |
الكمية**; LTR mirrors to **Quantity | Price | Discount ▼ | Remove**):

- **الكمية / Quantity** — the exact same `PosCartQtyControls` component (stepper + `PosNumericEditor`)
  used per-row before, now bound to the selected line only. No second quantity mutation path.
- **السعر / Price** — the exact same `PosNumericEditor` used for `setUnitPrice`/`normalizeUnitPrice`
  before, now bound to the selected line. Still gated by `posCfg.allow_unit_price_override` (hidden
  entirely when the tenant setting is off — verified in the default-off state: the control does not
  render at all, matching "visibility is not authorization" and unchanged server enforcement).
- **الخصم ▼ / Discount ▼** — see next section.
- **حذف / Remove** — the exact same `PosCartRemoveButton`, now bound to the selected line; still
  routes through the pre-existing reason-required confirmation dialog (`sensitiveAction` /
  `PosAuditReasonDialog`) unchanged.

**Deterministic safe state with no selection**: verified in real browser with an empty cart — every
control renders visibly disabled (`disabled` prop, newly added to `PosCartQtyControls` and
`PosCartRemoveButton`, both additive/optional/default-`false`) rather than silently acting on an
arbitrary line. New unit tests cover this exact behavior (see Tests).

Cart rows are now read-only and compact: product name + UOM select (unchanged, untouched), a
compact `×qty` and line total in the row's trailing column, unit price and a discount summary
(`−7.50` etc., only when a discount is applied) on a second line. No editor lives in the row.

### Discount ▼ — exact approved UX

The Discount button (`اردية / Discount` + a `ChevronDown` icon) opens the existing, reused
`Dropdown`/`DropdownItem` component (`@/components/ui/dropdown` — an existing, previously-unused-
in-POS popover with built-in exclusive-open, outside-click-close, and Escape-close behavior) showing
**exactly two rows**, each a radio + its own directly-editable numeric field, exactly as specified:

```
○ مبلغ      [ 7.50 ]
● نسبة %    [ 10   ]
```

Selecting the radio switches which field is the active input (disabled the other); typing in the
percentage field computes the equivalent amount via the existing `discountMinorFromPercent()` helper
(unchanged from the first pass) and commits it through the **same existing** `setDiscount()` path —
identical permission gate (`posCfg.allow_discount`), identical audit event, identical
gross-value clamp. Switching back to "مبلغ" shows the already-committed amount. Verified live: on a
3×25.00 line (75.00 gross), selecting "نسبة %" and typing `10` produced `7.50` in the "مبلغ" field
and in the cart totals simultaneously.

### Financial semantics — unchanged safety boundary

Confirmed still true after this correction: the authoritative, persisted cart representation
remains the fixed discount amount (`PosCartLine.discount`); no `discount_type` field, no schema
change, no new backend endpoint. Percentage is purely an input method that computes the amount
once, at entry time. If quantity or unit price change afterward, the amount does not
auto-recompute from a remembered percentage — this was true before this correction and remains
true; not expanded, not silently promised.

### Tests (this follow-up)

- `pos-responsive.test.ts`: replaced the fixed-px assertion with an `fr`-ratio assertion
  (`minmax(280px,1fr)_minmax(0,2fr)_104px` / `minmax(320px,1fr)_minmax(0,2fr)_148px`); the
  `w-full` stretch-fix guard test is unchanged (still required, still passing).
- `pos-cart-line-controls.test.tsx`: 2 new tests — `PosCartRemoveButton` and `PosCartQtyControls`
  render fully disabled and perform no action when `disabled` is passed (the "no selection" safe
  state).
- `pos-discount.test.ts`: unchanged, still 6/6 passing (the percent↔amount pure functions were not
  touched by this correction).

Commands and results:

| Scope | Result |
|---|---|
| Targeted (`pos-discount` + `pos-responsive` + `pos-cart-line-controls`) | 3 files, 24 tests passed |
| Broader POS frontend (`src/components/pos` + the two lib suites) | 28 files, 143 tests passed |
| Full frontend suite | 229 files, 1459 tests passed (+2 vs. the pre-follow-up 1457, exactly the 2 new disabled-state tests; 0 regressions) |
| `npm run build` | exit code 0 |
| Backend regression (still untouched) | 57/57 passed, SQLite |

### Browser QA (this follow-up)

Real Chromium, freshly registered tenant, real API (register → enable applications → warehouse →
category → 2 products → POS device → open session), `allow_unit_price_override` toggled on for one
pass specifically to verify the Price control renders.

| Scenario | Result |
|---|---|
| Desktop RTL, 1920px, empty cart — bottom bar visibly disabled | PASS |
| Desktop RTL, 1920px, two lines added, first auto-selected — cart ≈1/3, product ≈2/3 (measured 33.33% exactly) | PASS |
| Quantity via bottom bar (+1, +1) | PASS |
| Discount ▼ opens showing "مبلغ [ ]" and "نسبة % [ ]" together | PASS |
| Typing `10` in نسبة % on a 75.00 gross line → 7.50 computed, shown in "مبلغ" field and totals | PASS |
| Price control appears only when `allow_unit_price_override` is enabled; hidden by default | PASS |
| Delete via bottom bar → existing reason-required confirm dialog opens for the selected line | PASS |
| Scanner/focus recovery: add product → select line → Discount ▼ → percentage → Escape → click product tile ×2 → quantity correctly reaches 2 | PASS (verified via DOM read-back of the cart row, not just visually) |
| Desktop LTR + dark mode (locale cookie + `colorScheme: 'dark'`), selected line + Discount ▼ open showing "Amount [ ]" / "Percentage % [ ]" | PASS |
| Mobile (390×844) RTL: product grid, cart tab, selected line + bottom bar all render correctly, no new regression | PASS |

Screenshots captured locally only (not committed), consistent with this repo's established
convention.

### Remaining known limitation (unchanged from first pass)

Percentage discount does not live-recompute if quantity/price change after it was entered — still
explicitly out of scope (see "Financial semantics" above). Pre-existing mobile category-strip
clipping (documented in the PR-2C QA mission) remains untouched and out of scope.

## Git Metadata

- Repository: `safwan5001-source/Nebrax`
- Branch: `claude/pos-v2-pr3-cart-interaction`
- Base SHA: `256896e8cd36820ce3eaf41ed3ef10df249f8391` (confirmed: `main` HEAD at session start,
  matches the PR-2C merge SHA given in the mission brief)
- PR number/link: [#658](https://github.com/safwan5001-source/Nebrax/pull/658) (Draft)
- Previously reviewed Head SHA: `4c3bec9bcadcd887f31eb9ffd6189157f2d54a2d`
- Head SHA (after this correction): `894ae14bf1bb295f1f6be74d838c46f2b2632cc4`

## Next Step

> ChatGPT/Safwan review of the updated PR #658. No merge or deployment has been performed.
