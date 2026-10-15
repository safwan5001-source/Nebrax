# BL-001 root-cause report: is journal-line ORDER an accounting requirement?

Repo: <local path>, `main` at `8b2b42438`. Analysis only. No file under `tests/`, `app/`, `database/` was modified, nothing was committed or pushed (`git status --short` is empty). All execution happened in the assembled app `<local path>` against a throwaway Postgres 16.15 database `bl001`.

Legend: **[CODE]** = verified by reading code/docs/git. **[EXEC]** = verified by running something. **[INFER]** = inference, not directly verified.

---

## 0. Headline findings

1. **[CODE] The order of journal lines is NOT an accounting requirement.** No document, ZATCA/UBL artefact, posting contract, report total, or reversal rule depends on it. There is no persisted ordinal on `journal_lines`, and nothing in `CLAUDE.md`, `docs/`, or `design-system/` states a line-order rule.
2. **[CODE+EXEC] The root cause is test-side**, an unordered `SELECT` combined with an order-sensitive `assertSame` on a code-keyed array. The row order comes from whichever query plan PostgreSQL picks. I reproduced the failure on the original (pre-fix) test file, unmodified, at exactly the lines BL-001 cites (254 and 379).
3. **[CODE] BL-001 is already partly stale.** `main` already contains a test-only fix for `VatAdjustmentRoutingTest`: commit `99d1c4b72` (FC-3, #1505) added `canonical()` (`ksort`) to `journal()` and to every expected literal. `git merge-base --is-ancestor 99d1c4b72 HEAD` returns true. The BL-001 file still says `STATUS: OPEN`, "No fix is proposed", and describes the helper without `ORDER BY`. The FC-3 report (`docs/audits/horizon/FC-3-IMPLEMENTATION-REPORT.md:29`) records it as "CI robustness only".
4. **[EXEC] The same defect still exists, unfixed, in a sibling file:** `tests/Feature/VatSemanticRoutingTest.php:100-104` (`journal()` builds a code-keyed array with `mapWithKeys`, no sort) and 4 `assertSame` call sites (lines 169, 173, 228, 290) plus others. Under a plan that returns rows in account-id order, **6 of its 11 tests fail** on current `main`. It is currently green in CI only because of the plan PostgreSQL happens to pick.
5. **Separate, small production observation (not the cause of BL-001):** several production readers expose journal lines unordered or with a weak tie-break. See section 1. This affects presentation only, never amounts.

---

## 1. Production readers of journal lines / entries

Relations: `JournalEntry::lines()` is a plain `hasMany` with **no `orderBy`** (`app/Models/JournalEntry.php:24-27`). `Account::lines()` (`app/Models/Account.php:54`) and `CostCenter::lines()` (`app/Models/CostCenter.php:30`) are also plain. By contrast `ManualJournal::lines()` is `->orderBy('sort_order')` (`app/Models/ManualJournal.php:40`).

Note: `JournalLine` has no `line_number`/`sort_order`/`position` column. Schema: `id uuid, tenant_id, journal_entry_id, account_id, debit, credit, description, partner_type, partner_id, created_at, updated_at, cost_center_id, branch_id` (`database/migrations/2025_01_01_000002_create_accounting_core.php`, `..._000026`, `..._000032`; confirmed with `\d journal_lines` **[EXEC]**).

### 1a. Readers that return or depend on per-entry line sequence

| # | Reader (file:line) | Orders explicitly? | Does any behaviour / output depend on line order? |
|---|---|---|---|
| 1 | `LedgerService::post` returns `$entry->load('lines')` (`app/Services/Accounting/LedgerService.php:96`) | No | Returned collection order is DB-defined. Callers use it for ids/sums only (no caller in `app/` indexes into it; grep for `->lines->first/get/[n]` over `app/` found none). |
| 2 | `LedgerService::reverse` iterates `$entry->lines` (`LedgerService.php:131`) and returns `$reversal->load('lines')` (`:151`) | No (relation is unordered) | Reversal lines are created in whatever order the original was read. Each line is mirrored account-for-account (Dr<->Cr, same account, partner, cost centre, branch, `:133-144`). **No order-mirroring contract exists or is enforced**; sums and balances are order-independent. |
| 3 | `JournalEntryController::index/show` eager-load `lines.account` (`app/Http/Controllers/Api/JournalEntryController.php:50`, `:79`); `mapEntry` emits `'lines' => $lines->map(...)` (`:204-225`) | **No** on lines. Entries are ordered by `entry_date/number/created_at` then `orderByDesc('id')` (`:186`) | API payload carries lines in DB order. The web renders them in array order (`web/src/components/workspace/posted-entries.tsx:111`, `LedgerLinesTable`). Presentation only; totals are `sum('debit')`. |
| 4 | `InvoiceRelationsService::accountingLinks` loads `journalEntry.lines.account`, `cogsEntry.lines.account` (`app/Services/Accounting/InvoiceRelationsService.php:72-73`), maps `$entry->lines` (`:97`) | No | Presentation only (API `lines` array). |
| 5 | `PurchaseRelationsService` `loadMissing('journalEntry.lines.account')` (`:63`), maps lines (`:83`) | No | Presentation only. |
| 6 | `ReportService::journalEntries` (`app/Services/Reporting/ReportService.php:408`) groups `postedLines()` by entry and emits lines in fetch order | Lines: no. Entries: `entry_date, created_at` (see `postedLines`) | Report output lists lines in DB order; per-entry `debit`/`credit` totals and grand totals are order-independent. |
| 7 | `ManualJournalService::post` passes `$journal->lines` (ordered by `sort_order`) to `LedgerService::post` (`app/Services/Accounting/ManualJournalService.php:117-134`) | Draft lines yes (`sort_order`, unique per journal: `database/migrations/2025_01_01_000077_create_manual_journals.php:51,54`; `replaceLines` comment "يحفظ ترتيب السطور", `:174`) | The **user-chosen order exists only on the draft**. It is passed to `post()` as array order but is **not persisted** on `journal_lines`. `ManualJournalResource` (`app/Http/Resources/ManualJournalResource.php`) renders the *draft* lines (`sort_order`), not `journalEntry.lines`. So the only place where "order" is a product notion is the draft editor; once posted, the ledger holds a set, not a sequence. |
| 8 | `AccountSettingsController` data export `rows(JournalLine::class)` (`app/Http/Controllers/Api/AccountSettingsController.php:166-172`) | No | JSON dump of rows; row order not semantic. |

### 1b. Readers that order across entries (running balances)

| Reader | Ordering | Order-dependent output |
|---|---|---|
| `ReportService::postedLines` (`ReportService.php:861-872`): `join journal_entries ... orderBy('e.entry_date')->orderBy('e.created_at')` | `entry_date` (date) then `created_at` (**second precision**: `journal_entries.created_at` is `timestamp(0)` **[EXEC]**). No tie-break by `number`/`id`; none for lines inside an entry. | Feeds `accountLedger` (`:356`, running `balance` per row), `partnerStatement` (`:606`, running balance), `journalEntries` (`:408`). **Intermediate running-balance rows for entries posted in the same second on the same date are in undefined relative order**; opening and closing balances and totals are unaffected. This is the only production place where order has visible meaning (statement row sequence), and its tie-break is weak. Real but minor; not the BL-001 cause. |

### 1c. Readers that are order-independent (aggregates, sets, lookups)

Verified by reading; none of these depend on line order:
- `ReportService` trial balance / income statement / balance sheet (`:54`, `:97`, `:227`, sums via `JournalLine::query()...` at `:150`, `:287`).
- `ReportService::cashFlow` + `cashFlowCategory` (`:518`, `:587`: set intersection on account ids; net per entry is a sum).
- `VatRoleIntegrityService` (`:271-277`, `:415-419`, `:455-464`: `SUM`/`COUNT`/`MIN` with `GROUP BY`).
- `FinancialControlService` (`:86-94`: `GROUP BY journal_entry_id HAVING SUM(debit) <> SUM(credit)`).
- `FiscalCloseService` (`:373`, `:490`, `:692`: sums). Its closing-journal lines are explicitly sorted by account code *before posting* (`:409`), i.e. the author wanted a stable *input*, not a read-time contract.
- `InvoiceService` (`:1163-1170` sums), `AccountWorkspaceService::directBalances` (`:72-95`, `GROUP BY account_id`), `SalesReportService` (`:276` sum), `CorporateFuelAuthorizationService` (`:164` sum), `LedgerService::applyToBalance` (per-line increments, commutative).
- `InventoryOpeningService::buildEntry` sorts by branch (`ksort($valueByBranch)`, `:334`) for deterministic input, again not a read contract.

### 1d. ZATCA / UBL / printed documents

- **[CODE] ZATCA does not read journal lines at all.** `ZatcaService.php:240` iterates `$invoice->lines` (invoice document lines). `grep -il journal` over the ZATCA classes finds no journal-line access. QR/TLV, ICV, PIH, UBL are built from `Invoice`/`InvoiceLine`. Journal-line order cannot affect ZATCA output.
- **[CODE]** No PDF/print template or CSV export for journal entries exists in `app/` (no export method on `ReportController`; the only entry-level exports are the JSON in rows 3-6 above).
- **[CODE] Docs:** `grep` over `CLAUDE.md`, `docs/`, `design-system/` for line-order / ordinal / `line_number` rules finds nothing about journal lines. `design-system/v3/POSTING_PREVIEW.md:32` says the displayed entry is read-only ("no editing, deleting, or re-ordering") and `:88` orders *multiple entries* "by posting order" (entry-level, not line-level). The architecture rules in `CLAUDE.md` define balance (Sum debit = Sum credit), `source_type/source_id` linkage, bigint minor units, immutability, and reversal via `LedgerService::reverse`; none mention line sequence.

**Conclusion of section 1 [CODE]:** every monetary result is a function of the *set* of lines. The only order-visible surfaces are presentation (API `lines` arrays, report rows, statement rows).

---

## 2. How `LedgerService::post` stores lines; does `reverse()` mirror order?

**[CODE]** `LedgerService::post` (`LedgerService.php:43-97`): validates balance, then inside one transaction creates the `JournalEntry` and loops `foreach ($lines as $line)` calling `JournalLine::create([...])` (`:72-86`). There is **no ordinal field** (`position`, `line_number`, `sort_order`) in the payload or the table.

- Primary key: UUID via `BaseModel` -> `HasUuids` -> in this Laravel (11.57.0) `Str::orderedUuid()` (COMB / timestamp-first codec, `vendor/laravel/framework/.../HasUuids.php`; `vendor/ramsey/uuid/src/Generator/CombGenerator.php` timestamp "precise to 0.00001 seconds"). So ids are *roughly* time-ordered (10 microsecond granularity, remaining bits random). They are **not** a guaranteed insertion ordinal: two inserts within the same 10 us tick can tie and then sort randomly.
- `created_at` is `timestamp(0)` (second precision); all lines of an entry get the same value in practice.
- So **no persisted, reliable insertion order exists**; the only available order is the physical heap order or whatever index the planner uses.

**[CODE] `reverse()`** (`LedgerService.php:104-153`): iterates `$entry->lines` (unordered relation) and creates one mirrored line each. Mirroring is by *content* (same account, swapped Dr/Cr, same partner/cost centre/branch). There is no mirrored sequence guarantee: reversal insertion order = original read order, and reading either side back is again unordered. Tests that check reversal compare *sorted* account ids (`FiscalYearReopenTest.php:132-133`, `AccountingPeriodLockTest.php:257-258`, `PaymentReversalApiTest.php:140,172`) which is consistent with "order is not part of the contract".

---

## 3. Flake mechanics

### 3a. The query and plan **[EXEC]**
`JournalEntry::with('lines.account')` issues
`select * from "journal_lines" where "journal_lines"."journal_entry_id" in ($1) and "journal_lines"."tenant_id" = $2` (captured with `auto_explain`).
`journal_lines` has **no index on `journal_entry_id`**. Its indexes are `pkey`, `(tenant_id, account_id)`, `(tenant_id, branch_id)`, `(tenant_id, cost_center_id)`, `(partner_type, partner_id)`. For a tiny table the planner sees several equal-cost options (all `cost=0.14..8.16`):

- In the default fresh DB it used `Index Scan using journal_lines_tenant_id_branch_id_index` (`Index Cond: tenant_id = ...`, `Filter: journal_entry_id = ...`). With equal `branch_id` the index returns heap (insertion) order, so tests pass.
- If the planner uses the `(tenant_id, account_id)` index (or a seq/bitmap scan over a heap that has been churned by rolled-back test transactions / vacuum), rows come back in **account-id order** (for `(tenant_id, account_id)`) or physical order, **not posting order**.

Because test accounts get time-ordered UUIDs and the chart is seeded by code ascending, account-id order == ascending account code. The first BL-001 occurrence (actual `1150, 2110, 5115`, expected `2110, 5115, 1150`) is exactly that order.

### 3b. Plain-SQL demonstration **[EXEC]**
Copy of the `journal_lines` shape, 3 lines inserted in posting order 2110, 5115, 1150, same query:
- Seq Scan -> returns `2110 5115 1150` (insertion order).
- Index Scan on `(tenant_id, account_id)` -> returns `1150 2110 5115`.
Same data, same SQL; only the plan differs. (Script: `.../scratchpad/demo.sql`.)

### 3c. Reproduction on the real test file, unmodified **[EXEC]**
- `main`'s `VatAdjustmentRoutingTest` (has `canonical()`): 15/15 pass on pgsql in the default state.
- The **pre-fix file, byte-identical to git** (`git show 99d1c4b72^:tests/Feature/VatAdjustmentRoutingTest.php`, md5 `6b13c7d17f5b48f23937a39680b1e0e9`), kept outside the repo in the scratchpad and run by path (JUnit confirmed `file=` points to the scratchpad copy):
  - 3 consecutive runs on a fresh pgsql DB: **all 15 pass**. Plain repetition does **not** reproduce it (honest negative).
  - After forcing the plan: in the throwaway DB only, an event trigger drops the two competing indexes `journal_lines_tenant_id_branch_id_index` and `journal_lines_tenant_id_cost_center_id_index` right after creation, leaving `(tenant_id, account_id)`. Result: **7 of 15 fail**, with assertion failures at **file lines 254, 273, 338, 356, 379, 390, 545**. Line 254 = `a_sales_return_with_default_mappings_is_byte_identical_to_before` (the second occurrence in BL-001) and line 379 = the first occurrence's assertion. The diff is key order only (actual `1130, 2120, 4110` vs expected `4110, 2120, 1130`), amounts identical.
  - Same forced state, current `main` file (with `canonical()`): **15/15 pass, 102 assertions**.
- Caveats, stated plainly:
  - I forced the plan; I did not catch the flake naturally in CI conditions. I do not have the failing CI plan, so "CI used the account index" is **[INFER]**. The exact CI order for the second occurrence (BL-001 says `2120`/`4110` swapped) differs from my forced order (`1130, 2120, 4110`), so CI may have used a seq/bitmap scan over a churned heap rather than this index. What is verified is the *class* of cause: row order is plan/heap dependent and the test compares key order.
  - CI pgsql runs paratest in parallel, with rolled-back transactions and autovacuum/analyze, which can shift plan choice. **[INFER]** (not reproduced here).

### 3d. Which tests read without `ORDER BY` and assert key order
- **`tests/Feature/VatAdjustmentRoutingTest.php`**: pre-fix, all `journal()` call sites (14 uses; `assertSame` of literal arrays). On `main` now fixed via `canonical()` (`:213-241`).
- **`tests/Feature/VatSemanticRoutingTest.php`: still unfixed.** `journal()` at `:98-104` returns `$entry->lines->mapWithKeys(code => [debit, credit])->all()` with no sort; 13 `journal()` call sites, `assertSame` against literal arrays (e.g. `:169, :173, :228, :290`). **[EXEC]** Under the account-index plan, run standalone, `6 of 11` fail: `an_expense_with_default_mappings_posts_input_vat_to_1150_exactly_as_before`, `an_expense_posts_input_vat_to_the_current_tax_input_role_after_remapping`, `vat_amount_and_rounding_are_unchanged_by_routing`, `a_zero_rate_expense_does_not_require_a_tax_input_mapping`, `an_asset_acquisition_routes_input_vat_through_the_role_with_exact_amounts`, `a_tenant_mapping_never_routes_another_tenants_postings`. Also fails 6/11 when run after two other test files in the same process.
- Order-dependent only when several lines match (a latent risk, passed under the forced plan so not proven): `->lines->first(fn => debit > 0)` in `SalesPaymentAccountRoutingTest.php:129,278` and `InventoryCogsAccountRoutingTest.php:411,570`; branch-id sequence comparison in `PaymentReversalApiTest.php:141,173` (original vs reversal, in line order; passes while all lines share a branch).
- Order-insensitive (keyed lookups / sorted): `VatPosExchangeRoutingTest.php:146` (`mapWithKeys` then keyed access), `VatAdjustmentRoutingPostgresTest.php:220`, `FiscalYearReopenTest.php:132-136`, `AccountingPeriodLockTest.php:257-258`, `FuelReconciliationTest.php:82,112` and `FuelSupplyReceivingTest.php:53,114` (`->keyBy('account_id')`), `CostCenterTest.php:84-85`, `FiscalYearCloseTest.php:427` (sorted), and the `foreach (... as $line) assertSame(branch, ...)` loops in `SupplierRefundTest.php:641`, `CustomerRefundTest.php:800,866`, `BranchDimensionTest.php:54`.
- **Precedent for stable reads in tests:** `FiscalCloseVatAsOfTest.php:304-305` and `FiscalYearClosedPostingTest.php:191-192` snapshot with `->orderBy('id')`.
- **Systematic check [EXEC]:** I ran each of the 183 test files that mention journal entries/lines (`JournalLine|JournalEntry|journal_lines|journal_entries|->lines`) as its own process under the forced account-index plan on current `main`. Result: **only `VatSemanticRoutingTest` fails on ordering** (6 tests). `AssetTest` showed one unrelated-looking error in that sweep (`creating_an_asset_derives_total_without_an_entry`) that did **not** recur in 5 reruns (OK each time; 8 tests, 39 assertions); I did not diagnose it, treat it as an unrelated one-off, not evidence for or against this analysis. An earlier single-process run of the same 183 files (2627 tests) was fully green; I did not capture the plan used in that run, so I do not claim the forced plan stayed in effect there. This shows outcomes depend on planner/heap state, which is the point.
- Numbers: tests directory has 651 files in `tests/Feature`; 70 reference `JournalLine`; 183 matched the broader pattern above.

### 3e. Docs/CLAUDE.md on line order
None. See section 1d. The only mentions of the flake are the backlog item itself, `docs/plans/store/AWJ-STORE-CTX-3-QA-REPORT.md:92` (O-4, observed on #1496, so the flake has been seen at least 3 times: #1496, #1499, #1508), `docs/plans/store/visual-dimensions/AWJ-VD-1C-IMPLEMENTATION-REPORT.md:137`, `AWJ-VD-5-READINESS-REPORT.md:22,100`, and `docs/audits/horizon/FC-3-IMPLEMENTATION-REPORT.md:29`.

---

## 4. Conclusions

**(a) Is the order an accounting requirement?** **No** [CODE]. Accounting correctness is defined by the set of lines: Sum debit = Sum credit, linkage by `source_type/source_id`, bigint amounts, immutability, reversal via `LedgerService::reverse`. Reversal mirrors by content, not sequence. ZATCA/UBL does not read journal lines. Reports aggregate or list lines for display; no total depends on the order. The one place where an authored sequence exists (`manual_journal_lines.sort_order`) is draft-only and is not carried into `journal_lines`.

**(b) Root cause classification:** **Test-side only for BL-001.** Unordered `SELECT` + `assertSame` on a code-keyed array = order-sensitive assertion on a non-contract. PostgreSQL makes the order plan/heap dependent (verified mechanism, forced reproduction at the cited lines). Contributing production characteristics, *not defects causing the flake*: `JournalEntry::lines()` has no `orderBy`, no ordinal column, `journal_lines` has no index on `journal_entry_id`, and ids are not a strict insertion order.
A separate **low-severity production determinism gap** exists (not a financial defect): statements/ledger rows and API `lines` arrays use unordered lines or a weak tie-break (`created_at` at 1-second precision, no `number`/`id` tie-break, `ReportService.php:868-869`).

**(c) Options for a fix and blast radius**

| Option | Change | Risk / blast radius | Needs owner approval for accounting? |
|---|---|---|---|
| 1. Canonicalise in the test helper (already done for `VatAdjustmentRoutingTest`) | `ksort` by account code in `journal()` and on expected literals (or `sortBy` before building) | Tests only; values and Dr/Cr still compared strictly; no assertion removed. Same technique to apply to `VatSemanticRoutingTest::journal()`. | It is an accounting *test* file, so the owner rule applies; it was nevertheless merged in #1505 as "CI robustness only". |
| 2. Sort-insensitive assertion | `assertEquals` on keyed arrays, or compare `ksort`ed arrays | Tests only; `assertEquals` is looser (int/string coercion), so option 1 is stricter | Same as above |
| 3. Deterministic read in the helper | `->lines()->orderBy('account_id')` or `orderBy('id')`, e.g. via a shared trait/helper used by all REM-06 tests | Tests only. `orderBy('id')` is *not* insertion order (COMB ids tie within 10 us), so sort by account code explicitly | Same |
| 4. Production `ORDER BY` | Add `->orderBy('id')` (or similar) to `JournalEntry::lines()` and/or a tie-break (`e.number`, `journal_lines.id`) in `ReportService::postedLines` | Touches accounting read paths and API output order, no amounts. Does not give true posting order (ids are not a strict ordinal). Low risk but it changes observable response order; needs approval | **Yes** |
| 5. Persisted ordinal on `journal_lines` | New migration (`line_no`), `LedgerService::post/reverse` write it, backfill | DB + accounting-engine change on an immutable ledger; historic rows cannot recover their original order (backfill would be arbitrary); every writer path and all tests that insert lines directly are affected. No requirement justifies it | **Yes, separate approval; not recommended** |

**(d) Recommendation**
1. **Do not** add production determinism or an ordinal to fix BL-001. The order is incidental and the cause is the test.
2. Keep the already-merged Option 1 for `VatAdjustmentRoutingTest`, and apply the **same test-only canonicalisation to `VatSemanticRoutingTest::journal()`** (the only remaining file with the pattern; 6/11 fail under an adverse plan). If done, prefer one shared helper so a third copy cannot appear. This requires the owner's approval because it is an accounting test file; it changes no amounts or accounting logic.
3. **Update BL-001**: it still reads OPEN/"no fix proposed" while `main` already carries the fix for `VatAdjustmentRoutingTest` (#1505, `99d1c4b72`). A PR branch not rebased onto that commit (e.g. #1508 at `e8fabcf`) will still carry the old helper, which explains why it failed there.
4. Record the optional production observation (weak tie-break in `ReportService::postedLines`, unordered API `lines`) as a *separate* low-priority backlog item, only if the owner wants deterministic statement row order for entries posted in the same second. It is not an accounting requirement.

---

## 5. Evidence index and what I changed

- Throwaway DB: `bl001` on local Postgres 16. Event trigger `bl001_idx` was dropped after the experiments; `ALTER DATABASE ... RESET ALL` was applied. DB `bl001` still exists (throwaway).
- Scratch files (outside the repo): `.../scratchpad/prefix/VatAdjustmentRoutingTest.php` (byte-identical pre-fix copy; md5 above), `demo.sql`, `jfiles.txt`, `perfile.sh`, `perfile.log`, `jforced.xml`.
- `sync.sh` copied `app routes tests database config` from the repo into `<local path>` (the sanctioned assembled app); nothing was written back to the repo.
- Not verified: the actual CI plan at failure time; behaviour under paratest parallelism; the one-off `AssetTest` error.

---

## 6. ملخص بالعربية

- **ترتيب سطور القيد ليس متطلباً محاسبياً [قراءة الكود].** كل النتائج المالية (الأرصدة، الميزان، قائمة الدخل، الميزانية، فحص التوازن، العكس) دوال في *مجموعة* السطور لا في تسلسلها. لا يوجد عمود ترتيب (`line_number`/`sort_order`) في `journal_lines`، و`LedgerService::reverse` يعكس بالمحتوى (نفس الحساب مع تبديل مدين/دائن) دون ضمان تطابق التسلسل. ZATCA/UBL لا يقرأ سطور القيد أصلاً (يقرأ سطور الفاتورة `InvoiceLine`). لا يوجد نص في `CLAUDE.md` أو `docs/` أو `design-system/` يشترط ترتيب السطور.
- **السبب الجذري في الاختبار فقط [تنفيذ + كود].** الاستعلام `select * from journal_lines where journal_entry_id in (...) and tenant_id = ?` بلا `ORDER BY` ولا فهرس على `journal_entry_id`، فيختار المخطِّط فهرساً أو مسحاً يعيد الصفوف بترتيب غير ترتيب الترحيل، بينما `assertSame` يقارن ترتيب المفاتيح. أعدتُ إنتاج الفشل على ملف الاختبار القديم *دون تعديل* (الأسطر 254 و379 نفسها المذكورة في BL-001) بإجبار المخطِّط على فهرس `(tenant_id, account_id)` في قاعدة مؤقتة: فشل 7 من 15. التكرار العادي وحده لم يُظهر الفشل (3 مرات نجحت).
- **المشكلة مُصلَحة جزئياً على `main` أصلاً:** الالتزام `99d1c4b72` (FC-3 / #1505) أضاف `canonical()` (`ksort`) إلى `VatAdjustmentRoutingTest`؛ ملف BL-001 ما زال يقول «مفتوح». أما `VatSemanticRoutingTest::journal()` فيحمل النمط نفسه بلا إصلاح، ويفشل 6 من 11 اختباراً حين يتغيّر المخطِّط.
- **ملاحظة إنتاجية منفصلة وصغيرة:** بعض القراءات (قوائم `lines` في الـAPI، وكشف الحساب `ReportService::postedLines` الذي يرتّب بـ`entry_date` ثم `created_at` بدقة ثانية دون فاصل إضافي) تعرض الصفوف بترتيب غير مضمون عند تساوي الثانية؛ يمسّ العرض فقط لا المبالغ.
- **التوصية:** لا تغيير في منطق المحاسبة ولا إضافة عمود ترتيب (يتطلب هجرة وموافقة منفصلة ولا يوجد مبرر). تطبيق التوحيد القانوني نفسه (ترتيب برمز الحساب) في اختبار `VatSemanticRoutingTest` عبر مساعد مشترك بعد موافقة المالك، وتحديث وثيقة BL-001 لتعكس ما هو مدموج. أي ترتيب إنتاجي اختياري يُسجَّل كبند منفصل منخفض الأولوية.
