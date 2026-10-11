# AWJ-TAX-REM-02-PRINT-01 — Credit Note Print/PDF Financial Reconciliation · Implementation Report

| | |
|---|---|
| **Task** | Print/PDF follow-up to REM-02 (#1304): every amount a customer sees on a credit note reconciles with the posted amounts, to the halala. Closes the three open Codex threads on #1304 that were deferred to this slice (see §9). |
| **Branch** | `claude/awj-tax-rem-02-print-01` |
| **PR** | [#1315](https://github.com/safwan5001-source/Nebrax/pull/1315) — **retargeted to `main`** after #1304 was squash-merged (`56fcac62…`); no longer stacked (§1, §12). |
| **Base SHA** | `5b9d9dce86988ffd03b32bcc6c158710ee9110a8` — `origin/main`, which contains the #1304 squash `56fcac621411a10506ed626f43b4d5a99b2ed798`. *(Original stack base, now historical: #1304's head `2c82b01afbc8f2a5fb4ea9d01509c9fe1776eda9`.)* |
| **Head SHA** | Code is unchanged since `b3adda190da55e250d7940d436d9cd97e9f3af7b` (PRINT-01 `e6d5548` + PRINT-02 fix `b3adda1`). Retarget cleanup = merge commit `88e7072…` (tree `03588e1…`), then a docs-only commit for this report; the final head is the PR head. |
| **Status** | Implemented, web-only, **PR diff = 23 files only** (post-retarget, §12). Focused + full web suites green, production build green. **Not merged, not deployed, no migration, no backend change.** |

---

## 1. Why this was stacked on #1304 — **resolved: #1304 is merged, this PR now targets `main`**

The print fix needs stored amounts that **only #1304 creates**:

| Needed by the print fix | Where it comes from |
|---|---|
| `credit_note_lines.line_discount` | added by #1304's migration `2026_11_04_010000_add_source_line_to_credit_note_lines` (the column does not exist on `main`) |
| `credit_note_lines.unit_price_before_tax` | same migration |
| `line_discount` / `unit_price_before_tax` / `source_line_id` in the API payload | `CreditNoteLineResource` — #1304 only |
| builder already mapping `unit_price_before_tax` | `from-credit-note.ts` — #1304 only |

On `main` there is no discount datum for a credit-note line at all, so a branch from `main` could neither show a discount nor be tested against real payload shapes. **Dependency (now satisfied):** this PR was stacked on #1304's head `2c82b01`; #1304 has since been squash-merged to `main` (`56fcac62`) and this PR was retargeted to `main`. The branch's original #1304 commit history was then cleaned up without rewriting history — see §12. **#1304 itself was never touched** by this work.

## 2. Root cause

Stored data is correct; the print model could not express it.

1. `DocumentLine` carried `unitPrice · tax · total` only. For a discounted line, `qty × unit price + tax ≠ total` by exactly the discount, because the discount (stored in `line_discount`) was dropped by the builder.
2. The default credit-note columns were the generic 10-column invoice set, so the customer saw unit price, VAT and total side by side with no net amount between them.
3. For multi-unit inclusive lines the per-unit pre-tax price is a rounded **display** integer; `qty × unit` cannot equal the line's allocated net, and nothing said so.
4. The totals block's VAT row hard-codes **"(15%)"** in every language (`MODERN_TOTAL_LABELS.vat`, `invoiceDoc.vat`). A credit note at any other rate (REM-02 makes `sales.default_tax_rate` configurable) printed `VAT (15%) 5.00`.
5. The document `subtotal` posted by the service is **net of discount** (`Σ(line_subtotal − line_discount)`), so simply passing `totals.discount` to the existing totals block would have **counted the discount twice** (`subtotal − discount + tax ≠ total`).

## 3. What changed (all presentation)

| Area | Change |
|---|---|
| `builder/from-credit-note.ts` | Per-line reconciliation **from stored amounts only** (§4). New optional source fields `tax_rate`, `line_subtotal`, `line_discount`. Totals logic (§5). |
| `types/index.ts` | `DocumentLine`: optional `discount`, `netAmount`, `taxRate`, `unitPriceRounded`. `DocumentTotals`: optional `taxRate`. `DocItemsColumnId`: `line_discount`, `line_net`, `tax_rate`. All optional → every other builder compiles and renders unchanged. |
| `registry/document-types.ts` | `credit_note` default columns = `# · description · qty · price before tax · discount · net before VAT · VAT rate · VAT · total`. Registry validation still accepts only the persistable column ids (`DOCUMENT_ITEMS_COLUMN_IDS` unchanged). |
| `doc-items-table.tsx` + 7 presentation files | Labels / values / widths for the three columns (the width `switch` in each composition is exhaustive, hence one small block per file). Footnote under the table only when a unit price is rounded. |
| `doc-totals.tsx`, `visual-v2.ts`, `modern-bilingual-label.tsx` | `applyVatRateToLabel`: replaces/removes the hard-coded `(15%)` **only** when the builder declared `totals.taxRate`; no declaration ⇒ the label is byte-identical to before. |
| `messages/{ar,en}.json` | 4 keys in `invoiceDoc`: `line_discount`, `line_net`, `tax_rate`, `unit_price_rounding_note`. |
| `invoice-pdf.ts`, `block-properties-editor.tsx` | Placeholder entries only, to satisfy exhaustive `Record<DocItemsColumnId, …>` types. Unreachable: the jsPDF invoice generator never prints a credit note and the editor lists only persistable columns. |

**Not touched:** any PHP, migration, tax/ledger/return/POS/invoice-posting code, ZATCA, `PrintTemplateContract.php`, the template editor's column picker.

## 4. Per-line rule (no invented numbers)

```
tax = line_tax            total = line_total            (stored)
gross = line_subtotal     discount = line_discount      (stored, may be absent)

discount known   ⇔ gross − discount == total − tax                      → net = gross − discount
historical row   ⇔ discount absent AND gross == total − tax             → discount = 0 (the identity proves it)
anything else                                                           → net = total − tax, discount = null  ("—", never assumed 0)
```

* The printed unit price is the stored pre-tax price. For rows from before REM-02 (no `unit_price_before_tax`) the stored `unit_price` is used **only if `qty × unit_price == line_subtotal`** proves it is a pre-tax price; otherwise the column shows "—".
* `unitPriceRounded = discount known && qty × displayed unit price ≠ net + discount` → drives the footnote. The line's authoritative amounts are never derived from the displayed unit price.

## 5. Totals rule

`note.subtotal` is posted **net**. The block prints `subtotal-before-discount, discount, VAT, total` **only when all of these hold to the halala**; otherwise it prints the stored totals exactly as before, with no discount row:

* every line's discount is known and Σ discount > 0
* Σ line net == posted `subtotal`, Σ line VAT == posted `tax_amount`, `subtotal + tax == total`

Then: printed subtotal = posted subtotal + Σ discount; printed discount = Σ `line_discount` (line discount **plus** the header-discount share, which the service already folded into `line_discount` — counted once). Printed `tax` and `total` are always the posted values.

## 6. Before / after

| Case | Before (row · totals) | After |
|---|---|---|
| 1 × 115.00 inclusive | `100.00 + 15.00 = 115.00` (already fixed in #1304) | `qty 1 · 100.00 · disc 0.00 · net 100.00 · 15% · 15.00 · 115.00`; totals `100.00 / 15.00 / 115.00` — no discount row |
| 100.00 − 20.00, VAT 12.00 | `100.00 · 12.00 · 92.00`; totals `80.00 / 12.00 / 92.00` (the 20.00 appears nowhere) | `1 · 100.00 · disc 20.00 · net 80.00 · 15% · 12.00 · 92.00`; totals `100.00 − 20.00 + 12.00 = 92.00` |
| Header discount 20.00 over 2 × 100.00 | each row `100.00 · 13.50 · 103.50`; totals `180.00 / 27.00 / 207.00` | each row discount 10.00 · net 90.00 · 13.50 · 103.50; totals `200.00 − 20.00 + 27.00 = 207.00` |
| 7 × 0.10 inclusive (net 0.61, VAT 0.09) | `7 · 0.09 · 0.09 · 0.70` | `7 · 0.09 · 0.00 · net 0.61 · 15% · 0.09 · 0.70` + footnote: *unit prices are shown rounded for display; the recorded line amounts are authoritative* |
| Codex example 7 × 0.01 | `7 · 0.01 · 0.01 · 0.07` | `7 · 0.01 · 0.00 · net 0.06 · 15% · 0.01 · 0.07` + footnote |
| Note at 5 % VAT, 100.00 | VAT row labelled **"(15%)"** with 5.00 | labelled **"(5%)"**; mixed rates ⇒ no percentage |
| Pre-REM-02 payload (no new fields) | `50.00 · 15.00 · 115.00` | net 100.00 derived (`115.00 − 15.00`), discount "—", rate "—"; stored totals and original VAT label untouched |

Arabic and English render the same figures: tests compare the numeric content of every row and totals block across `ar` and `en` for all 12 template compositions.

## 7. Tests and results

New (all deterministic, all fail when the logic is broken — mutation-checked):

* `builder/from-credit-note.reconcile.test.ts` — 13 tests: 115.00 = 100.00 + 15.00; 100 − 20 + 12 = 92; header-discount allocation; multi-unit inclusive rounding; Codex 7 × 0.01; three partial notes of one line (Σ net 0.26, Σ VAT 0.04, Σ total 0.30); single/mixed rate; pre-REM-02 payloads (with and without `line_subtotal`); unreconcilable stored data ⇒ no discount row; drifted totals ⇒ printed as stored; **300 seeded random notes** asserting Σ line totals = posted total, Σ VAT = posted VAT, `subtotal − discount + VAT = total`, and `ar` model = `en` model except direction.
* `components/document-credit-note-reconciliation.test.tsx` — 53 tests: for each of the 12 compositions × `ar`/`en`: row figures, totals figures, 5 % label, rounding footnote; historical payload renders; invoice-shaped model keeps its column count and `15%` label; only `credit_note` declares the new columns and every other type's default set stays persistable.

Mutations run and caught: discount not added back to the printed subtotal (4 failures), rounding flag disabled (1), VAT-label override disabled (12).

| Run | Result |
|---|---|
| Focused: `builder/from-credit-note*` | 19 passed |
| Affected: `modules/documents`, `components/credit-notes`, `modules/invoices`, `modules/print-templates` | 52 files / 459 tests passed |
| **Full web suite** (`npm test`, the CI command) — original run | 466 files / 4,653 tests passed |
| **Full web suite on the post-retarget tree** (§12; includes the 21 PRINT-02 tests and the tests now on `main`) | **478 files / 4,828 tests passed** |
| **`npm run build`** (the CI command) | **passed** |
| `tsc --noEmit` | 0 new errors (26 pre-existing errors in unrelated test/e2e files, identical set before and after) |
| PHP suites | not run — no PHP, migration or API change in this PR |

CI: see §12 for the post-retarget head. (Earlier head `b3adda1`, stacked: 6/6 success.)

## 8. Compatibility

* **Other document types:** their default columns, widths of existing columns, labels and totals are unchanged (asserted). New optional fields default to absent; the VAT label override needs an explicit declaration only the credit/debit-note builder makes.
* **Saved / frozen print-template layouts:** per the registry contract, type defaults are *fallbacks*; a tenant layout (or a frozen revision on a posted note) that stores explicit `columns` keeps exactly those columns. Those tenants therefore do **not** get the new columns (see §10-1). Their totals block and VAT label still improve.
* **Print vs PDF vs thermal:** the page renders `CreditNoteDocument` for `print-root`, `pdf-print-root` and `thermal-print-root`; the PDF is a capture of that DOM and all three consume the one model built by this builder. **Correction (PRINT-02):** the thermal *receipt template* is not the A4 table/totals — it renders its own totals and, in this PR's first version, ignored `totals.discount` and `totals.taxRate`, so a discounted note printed `100.00 + 12.00 ≠ 92.00` on 58/80 mm. Fixed in `b3adda1` (`templates/thermal-receipt.tsx`: discount row, real VAT rate, rounding note); verified in real Chromium renders (PRINT-02 report, #1320). Side effect: any document with `totals.discount > 0` printed on thermal now shows the discount row (this also corrects invoices with a header discount).
* **Debit notes:** share the builder, so the data and VAT label apply, but `debit_note` keeps the generic default columns (unchanged by design).
* **Ledger / tax / schema:** untouched. No posted value is read differently; the builder only re-expresses stored values.

## 9. Codex threads on #1304 this slice resolves

| Thread (open on #1304) | Resolved by |
|---|---|
| *Make printed line amounts reconcile* (`CreditNoteService`) | net/discount/rate columns + totals identity (§3–5) |
| *Render sourced discounts on credit-note lines* (`from-credit-note.ts`) | `line_discount` carried into the model and printed row-level and in totals |
| *Reconcile multi-unit inclusive lines after rounding* (`CreditNoteService`) | authoritative net/VAT/total printed; rounded unit price flagged, not hidden |

I did not reply to or resolve these threads on #1304; that is for the owner once this slice is accepted.

## 10. Remaining issues and limitations

1. **Template editor cannot add the new columns.** They are render-time defaults only. Letting a tenant add them to a saved layout needs: `DOCUMENT_ITEMS_COLUMN_IDS` (web registry), `PrintTemplateContract::ITEM_COLUMNS` (PHP, `app/Support/PrintTemplateContract.php:72`), and the editor's list — a backend contract change I deliberately did not make. Also, a tenant who edits a credit-note layout's columns starts from the *generic* default and loses the reconciliation columns.
2. **Header discount share is not separable.** The service stores one combined `line_discount` per line; the print shows one "Discount" column. A separate "line discount" vs "header share" would need a stored split (source-data change — not made).
3. **Historical rows:** unknown discount prints "—" (never 0); unit price prints "—" unless proven pre-tax by `qty × price == line_subtotal`. Net is derived from the stored `total − tax` identity.
4. **Printed "Subtotal" for a discounted note is the pre-discount amount**, so it differs from the posted `subtotal` field (net) by the discount; `printed subtotal − printed discount = posted subtotal` exactly. Owner may prefer to keep the net subtotal and show the discount informationally — a policy/wording choice, not a calculation.
5. **Shared label wording:** the discount row uses the existing shared label ("Invoice discount" / "خصم الفاتورة"); not changed to avoid touching invoices.
6. **Layout — now verified in a real browser (PRINT-02, #1320):** A4 (all 12 compositions), thermal 80 mm and 58 mm, Arabic and English, saved layouts — 122/122 renders reconcile. **Still not verified:** A5 (AWJ has no A5 paper size or template) and a physical thermal printer / roll.
7. The jsPDF `invoice-pdf.ts` path (invoices only) got placeholder map entries; credit notes never use it.

## 11. Recommended next step

1. ~~Merge #1304 and retarget~~ — done (#1304 merged `56fcac62`; #1315 retargeted; cleanup in §12).
2. ~~Visual QA on A4/thermal~~ — done (PRINT-02). Remaining: A5 scope decision and a physical thermal-printer test.
3. Decide §10-1 (allow the columns in saved layouts: web registry + PHP `ITEM_COLUMNS` + editor) and §10-4 (printed subtotal wording).
4. The three print-related Codex threads belonged to #1304 (now merged); this PR is their resolution.

**Not merged. Not deployed. No migration. No production change.**

---

## 12. Post-squash retarget cleanup (R1)

**Symptom.** After #1304 was squash-merged (`56fcac621411a10506ed626f43b4d5a99b2ed798`) and this PR was retargeted to `main`, GitHub reported **76 changed files** and `mergeable=false`. **Cause:** the branch still carried #1304's 27 original commits, which are not ancestors of the squash commit, so the merge-base stayed at the pre-#1304 `main` (`bdecbd01…`) and the three-dot diff re-included all of REM-02 (54 of its 56 files are byte-identical on `main`; `ar.json`/`en.json` differ only because other work reached `main` first).

**Approach — non-destructive, no history rewrite, no force-push.** Merged current `main` into the branch (merge commit `88e70722536d21e4545f61fe4844f076325761fa`, pushed as a plain fast-forward from `b3adda19`). That makes `main` the merge-base, so the PR diff is only the incremental change.

| Step | Result |
|---|---|
| Fetch | `main` = `5b9d9dce86988ffd03b32bcc6c158710ee9110a8` (contains #1304 squash `56fcac62`); PR head was `b3adda190da55e250d7940d436d9cd97e9f3af7b`; 30 commits ahead of `main`, merge-base `bdecbd01` |
| Conflicts | **1:** `web/src/modules/documents/builder/from-credit-note.ts`. `main`'s blob `1539ef5` == #1304's old-head blob (both sides had applied the same #1304 edit; this branch adds the PRINT-01 rewrite on top) ⇒ resolved by keeping this branch's version (proof: `git diff 2c82b01..HEAD` and `git diff main..HEAD` are identical for that file). `ar.json`/`en.json` auto-merged. No conflict markers. |
| **Independent cross-check** | Replayed this branch's three commits (`e6d5548`, `1287f51`, `b3adda1`) with `git cherry-pick` onto a clean `main` worktree: resulting tree `03588e1ebb57d130e06463daf5d0a8dfc3c75eb6` is **byte-identical** to the merge result's tree. So the merge result is exactly *`main` + the PRINT commits*, nothing more, nothing lost. |
| PR diff vs `main` (three-dot) | **23 files, +1,074 / −33** — identical to the incremental change set against #1304's old head. GitHub now reports `changed_files: 23`, base `main` @ `5b9d9dce`, head `88e70722`. |
| Forbidden areas in the diff | **None:** no `*.php`, no `migrations`, no `app/`, no `database/` — no tax, ledger, POS, migration or accounting change. |
| Verified fixes preserved | thermal discount row / VAT rate / rounding note (`thermal-receipt.tsx`), saved-layout discount note, column widths, builder, fixtures and all tests are in the diff unchanged (tree-identical to `b3adda1`'s content). |

**Verification on the post-retarget tree (local):**

| Check | Result |
|---|---|
| Focused: `modules/documents`, `design`, `components/credit-notes`, `modules/invoices`, `modules/print-templates` | 58 files / 585 tests pass |
| Full web suite (`npm test`) | **478 files / 4,828 tests pass** |
| `npm run build` | passes |
| `tsc --noEmit` | 48 errors, **identical set to pristine `main`'s 48** (all pre-existing, in unrelated test/e2e files, e.g. `SliderFields.test.tsx`) — **0 introduced** |

**CI and mergeability on `88e70722`:** **pending at time of writing** — web build, PHP sqlite/pgsql and the `storefront` check were queued/running on the merge commit. This PR changes no PHP; the previous head `b3adda1` was 6/6 green. The final result and `mergeable` state are recorded in the PR checks and in the follow-up status note.

**Residual notes.** The PR still lists 31 commits (the old #1304 commits remain reachable through the branch history); this is cosmetic — the diff is 23 files — and irrelevant if the PR is squash-merged like #1304. Cleaning the commit list itself would need a force-push of this branch and was deliberately not done. The PRINT-02 evidence PR (#1320) is stacked on this branch's previous head and is unaffected (docs/QA only).

**Not merged. Not deployed. No migration. No production change.**
