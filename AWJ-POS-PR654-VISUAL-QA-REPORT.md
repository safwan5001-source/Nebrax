# AWJ POS — PR #654 Visual QA Report

**Type:** Visual QA only — no code modified, no commit, no push, no merge, no deploy.

## 1. Exact Head SHA inspected
`af5d17304778861e2d254d9ad5449e6460dd274c` — verified via `git rev-parse` before testing; matched exactly.

## 2. Browser/environment
Headless Chromium (`/opt/pw-browsers/chromium`) driven via Playwright, against a real running `next dev` server (port 3000) and a real Laravel `php artisan serve` backend (port 8000). A freshly registered tenant, real products/categories/images/POS session were created through the actual API — no mocks, no jsdom.

## 3. Viewports inspected
- Desktop: 1440×900
- Mobile: 390×844 (touch-enabled)

## 4. RTL result — PASS
Topbar, category sidebar, cart panel, and product grid all correctly mirrored. Session badge correctly reads "الجلسة" (not "الوردية" — confirms PR-1's terminology fix survives). "إدارة الجلسة" label correct.

## 5. LTR result — PASS
Full mirror confirmed correct (cart left, categories right, topbar reversed). "Session Management" / "Session POS-2026-00001" labels correct.

## 6. Images ON result — PASS
Image area renders, aspect ratio preserved, missing-image fallback (generic icon + company name) works correctly, uploaded image renders correctly.

## 7. Images OFF result — PASS (minor observation)
Media area is fully absent (not just hidden), cards visibly denser (2 rows of 8 products fit vs. fewer before), name/price/stock remain aligned.
Minor observation: favorite/info icons sit close to the first line of very long product names in this mode — tight, but no actual clipping/overlap observed. Not blocking.

## 8. Quick View result — PASS
Opens from the Info icon without adding to cart (cart stayed at 0/empty throughout every test). Dialog is clearly read-only. Close via both the X button and Esc key work. No clipping. Balanced in both RTL and LTR.

## 9. Cost/profit hidden result — PASS
With `show_cost_profit_in_pos` OFF (default), Quick View for a product that actually has `purchase_price`/`profit_margin` stored in the database shows **no** commercial section at all — no blank section, no zero values, no placeholder implying authorization.

## 10. Cost/profit authorized result — PASS (reproduced live, not simulated)
Toggled `show_cost_profit_in_pos=true` for the owner (who already holds `products.view_cost` via the `*` wildcard). Confirmed via a direct API call that `purchase_price`/`avg_cost`/`profit_margin` are now actually returned by `GET /pos/products`, then visually confirmed Quick View renders a "معلومات تجارية" (Commercial information) section with all three values — correctly positioned below stock info, not dominating the dialog, and absent from Product Cards.

## 11. Stock-state result — PASS with a defect (see §16 below)
Out-of-stock ("نفد المخزون", red) renders correctly. Low-stock renders, but the combined text is visually truncated mid-word.

## 12. Edge-case result
Long Arabic/English names truncate cleanly (2-line clamp + ellipsis, no jagged wrap). Missing image falls back correctly. Long barcode/SKU display fine. Multiple-UOM was **not fully reproducible** in this session — the alternate unit only appears when an active customer price list has explicit pricing for it, which this QA setup did not configure. This is existing, unrelated pricing behavior (R2-era), not a PR-2/PR-2S defect — a test-data limitation, not a code finding.

## 13. Mobile smoke result — PASS
2-column grid, favorite/info touch targets reachable, Quick View fits the viewport with no horizontal overflow, bottom nav intact.

## 14. Visual defects found
One real defect (§16) requiring a code fix; one minor, non-blocking observation (§7).

## 15. Screenshots produced
8 screenshots were sent to the user directly in chat during the QA session:
- `01-desktop-rtl.png` — full desktop RTL workspace
- `05-desktop-ltr.png` — full desktop LTR workspace
- `06-images-off.png` — images-off dense grid
- `04-milk-card.png` — zoomed low-stock truncation defect
- `08-quickview-hidden.png` — Quick View with cost/profit correctly hidden
- `09b-quickview-cost-authorized.png` — Quick View with commercial section shown
- `10-mobile-rtl.png` — mobile product grid
- `11-mobile-quickview.png` — mobile Quick View

## 16. STOP — one issue needs a code fix (not implemented)

**Problem**: In `pos-product-tile.tsx`, the stock line for a low-stock item concatenates
`"{availableLabel}: {qty} · {lowStockLabel}"` into a single `truncate whitespace-nowrap` line.
At the standard card width this overflows and clips mid-word — the cashier sees
"المتوفر: 3 · مخزون منـ" (or "In stock: 3 · Low sto…" in English), never the full
"low stock" word. Confirmed identically in both RTL and LTR, so this is a width/layout
issue, not a locale issue.

**Reproduction steps**:
1. Create a product with `track_inventory=true` and `reorder_level` ≥ `quantity_on_hand` > 0.
2. Open the POS product grid at 1440px (or narrower) with `show_product_images` on.
3. Observe the stock line on that product's card — the low-stock qualifier is
   visually cut off.

**Proposed smallest fix (not applied — awaiting approval)**: stop concatenating both
pieces of information onto one truncated line — e.g., render the low-stock qualifier
on its own short second line under the stock count, or replace the trailing text
qualifier with a small badge/dot that always fits regardless of card width, so the
safety-relevant "low stock" state is never illegible.

## Overall verdict (at the time of the original QA session)

**PASS WITH MINOR ISSUES**

No code was modified during this QA session. Working tree confirmed clean
(`git status --short` → no output) before and after.

---

## Post-Fix Visual Re-Verification

**Original inspected Head SHA**: `af5d17304778861e2d254d9ad5449e6460dd274c`

**Original defect found**: the low-stock stock line in
`web/src/components/pos/pos-product-tile.tsx` concatenated
`"{availableLabel}: {qty} · {lowStockLabel}"` into a single
`truncate whitespace-nowrap` line, which clipped the "low stock" qualifier
mid-word at normal card widths, in both RTL and LTR.

**Approved fix**: split the stock line into two independent lines inside the
same `data-testid="pos-product-stock"` container — the quantity/out-of-stock
line unchanged, and (only when low-stock applies) a new second line
(`data-testid="pos-product-low-stock"`) carrying just the low-stock label on
its own, using the existing `text-warning` semantic token. No stock
calculation, reorder threshold, quantity logic, out-of-stock logic, or
server-authority behavior was touched — presentation only.

**New Head/commit tested**: the fix was verified locally against the working
tree before commit; see the chat reply for the exact commit SHA pushed to
`claude/pos-v2-pr2-product-category` immediately after this report was
finalized.

### RTL re-check result — PASS
Desktop 1440×900. Normal stock ("المتوفر: 50"), low stock
("المتوفر: 3" / "مخزون منخفض" — both fully readable on two separate lines,
confirmed via both screenshot and raw DOM `textContent`), and out-of-stock
("نفد المخزون", red) all correct. No clipping or overflow anywhere in the
grid.

### LTR re-check result — PASS
Same grid, English locale. "In stock: 3" / "Low stock" fully readable on two
lines (confirmed via screenshot and DOM `textContent`: `"In stock: 3Low stock"`
with no truncation). Normal and out-of-stock states correct. Icons/actions
remain correctly positioned; Quick View layout unaffected (not touched by
this fix).

### Mobile re-check result — PASS
390×844. Low-stock status remains fully readable on two lines for both a
short-named and a long-named product. Product Cards remain usable, no
destructive height/layout regression, Info/Favorite remain reachable, no
horizontal overflow.

### Normal-stock result — PASS (unchanged)
Renders exactly as before the fix.

### Low-stock result — PASS (fixed)
Fully readable in RTL, LTR, and mobile — confirmed both visually and via DOM
text content extraction (no reliance on screenshots alone).

### Out-of-stock result — PASS (unchanged)
Renders exactly as before the fix; untouched code path.

### Long-name/control-overlap result — PASS
Tested a product with both a long English name (86 characters) AND
low-stock simultaneously (the hardest combination): 2-line name clamp,
price, and both stock lines all render without overlapping the
favorite/info icons above. No regression introduced by combining long name
with the new two-line stock presentation.

### "3 Issues" investigation result — Unrelated Next.js dev tooling, not an application defect
The indicator is a `<nextjs-portal>` custom element — Next.js's own
development-mode overlay/issue counter, confirmed by inspecting its shadow
DOM (it embeds its own Bootstrap-based reset CSS, entirely separate from the
AWJ app's styling). It is driven by the same pre-existing `next-intl`
`INVALID_KEY` console warning (about unrelated `developer.events.*`
namespace keys containing dots) that has been observed and documented as
pre-existing/unrelated throughout every prior session on this repository.
The count is not a fixed defect tally — it grows with accumulated
warnings across a long-running dev session (observed as low as 3 and as
high as 23 across different points in this session) and disappears
entirely in a production build (`next build`/`next start`), which this
mission's own passing `npm run build` (exit 0) already confirms. Not fixed
here, as it is out of this mission's scope and unrelated to PR-2/PR-2S.

### Remaining visual observation
The images-off tight icon/name spacing noted in the original QA (§7 above)
was not touched by this fix — it remains a minor, non-blocking observation,
not a defect requiring action.

### Final QA verdict (post-fix)

**PASS**

All originally-identified low-stock truncation cases (RTL, LTR, mobile,
combined with a long product name) are now fully readable. No regression
was found in normal-stock, out-of-stock, Favorite/Info isolation, or
Quick View behavior. Category Color and Category Presentation Mode
(Default|Image|Color) remain explicitly DEFERRED/BLOCKED, unchanged by this
fix.
