# AWJ-ERP-UI-H2 · A2–A4 — Phase A closure report (for the Decision Gate)

STATUS: **AT DECISION GATE** (D3) · evidence and documentation only · DATE: 2026-10-15
PR: #1520 (open, not merged before the owner's review) · Plan: [AWJ-ERP-UI-H2-START-PLAN.md](../AWJ-ERP-UI-H2-START-PLAN.md) · A1: [report](AWJ-ERP-UI-H2-A1-REPORT.md), merged in #1516 → `24528be`

## الملخص (للمالك)

- **المرحلة A اكتملت ووصلت بوابة القرار.** A1 مدموج. A2 (التدقيق) وA3 (البحث المرجعي) وA4 (عقد الواجهة) في PR #1520 مفتوحاً لمراجعتك. **لم يُكتب أي كود منتج، ولا نشر، ولا تفعيل لـv3.**
- **149 ملاحظة** (‏9 P0 · 30 P1 · 87 P2 · 23 P3) في **28 بنداً موحّداً** (`ERP-UI-H2-001..028`)، كلٌّ مربوط بقاعدة في العقد A4 وبشريحة B/C. الـP0 مُتحقَّق منها في الكود.
- **خللان خلفيان خارج H2** يحتاجان مهمة مستقلة: نقطة البيع ترفض البيع (422) لكل منتج بلا قالب وحدات، وكشف المورّد يُسقط استرداد المورّد.
- **الثيم الثالث AWJ Core** دُمج في `main` (#1522). حُدِّثت مصفوفة التحقق البصري: Default دائماً، وCore Light عيّنةً في كل شريحة تمسّ القشرة أو المكوّنات المشتركة، و**Core Dark دليلٌ لا معيار** حتى تُغلق مهمة متابعة ألوانه. ولا يعدّل H2 توكنز الثيم ولا مكوّناته.
- **مطلوب منك** (§7): قرار الإصلاح العاجل للـP0 (واجهة فقط)، والمسار الخلفي المنفصل، وO-14، وأسئلة السياسة، واعتماد العقد A4، ثم إطلاق B وC.

## 1. Deliverables

| Slice | Document | Content |
|---|---|---|
| A1 (merged) | [A1 report](AWJ-ERP-UI-H2-A1-REPORT.md), [inventory](../h2-a-evidence/ROUTE-INVENTORY-H2.md), [baseline](../h2-a-evidence/BASELINE-CRAWL-H2.md), [kit adoption](../h2-a-evidence/KIT-ADOPTION-H2.md), [tools](../h2-a-evidence/tools/README.md) | 239 pages classified (228 in scope). Baseline: 235 URLs × 6 configurations = 1,410 real-browser loads. Repeatable fixture and evidence tools |
| **A2** | [AWJ-ERP-UI-H2-A2-AUDIT.md](../AWJ-ERP-UI-H2-A2-AUDIT.md) | Consolidated audit: P0 table verified in code, backlog 001–028, cross-module patterns, module state matrices, O-14, dependencies outside H2, Decision Gate questions, coordination with AWJ Core |
| A2 group reports | [PLT](../h2-a-evidence/A2-PLT.md) · [FIN](../h2-a-evidence/A2-FIN.md) · [SAL](../h2-a-evidence/A2-SAL.md) · [OPS](../h2-a-evidence/A2-OPS.md) | Verbatim auditor reports. Each has state matrices, real workflows, number parity, findings with *Observed* kept separate from *Direction*, and a "not verified" list. 63 curated images plus 2 from the probe re-run |
| **A3** | [A3-REFERENCE-RESEARCH.md](../h2-a-evidence/A3-REFERENCE-RESEARCH.md) | Patterns observed in Primer, Carbon, Shopify Polaris, Material 3, Zoho Books, Business Central, Daftra and Foodics. 40 shots. External evidence is kept separate from candidates; AWJ decisions live in A4 §5 |
| **A4** | [AWJ-ERP-UI-H2-1-UI-CONTRACT.md](../AWJ-ERP-UI-H2-1-UI-CONTRACT.md) | Rulebook for every code slice: R-STATE, R-CONFIRM (T0–T3), R-PERM, R-MONEY, R-VALID, R-TEXT, R-NAV/LINK/DATE, R-A11Y; patterns P-LIST, P-FORM, P-DOC, P-DETAIL, P-SETTINGS, P-REPORT, P-FLOOR, P-STUDIO; acceptance per slice, including the theme matrix; AWJ decisions and items not adopted; backend/owner dependencies |
| Screen atlas | Private artifact (link in A2 §1) | 228 screens, desktop 1440 and phone 390, with the backlog items per screen and the Decision Gate list |

## 2. Headline results

| | P0 | P1 | P2 | P3 | Total |
|---|---|---|---|---|---|
| PLT · FIN · SAL · OPS | 9 | 29 | 86 | 23 | 147 |
| Probe re-run (A2 §3a) | 0 | 1 | 1 | 0 | 2 |
| **All** | **9** | **30** | **87** | **23** | **149** |

- **Financial numbers:** every checked figure equals the API value formatted by `formatRiyal`, except three:
  - SAL-03: the partner's amount due is computed in the browser.
  - OPS-03: the supplier statement drops refunds (backend).
  - PLT-06: the dashboard counts drafts as unpaid and sums cash in the browser.
- **Isolation:** tenant B never appeared. A branch-scoped user saw none of the main branch's documents. Two scope questions go to the owner: SAL-13 and OPS-32.
- **Most widespread defects:**
  - An irreversible action (post, pay, transfer, delete, close a session) with no confirmation, in 15+ places.
  - A load error shown as "no data" or «0», or as a blank settings or record form that can be saved over real data. This affects 40+ routes; PLT-01, SAL-01 and PROBE-01 are the worst cases.

## 3. Review and verification trail

| Gate | Result |
|---|---|
| **Independent Reviewer + AWJ Guardian (A2–A4)** | CHANGES REQUESTED (1 P1, 5 P2, 11 P3) → fixed in `0ecda08` → re-review **PASS**; the 5 remaining P3 nits were fixed in `659ff63`. The P1 was a Floor rule that overrode tenant settings (negative stock, blind cash count); it now follows them, and a rule was added that a posture rule never overrides a configurable policy |
| **Codex (#1520)** | 7 threads, all answered and resolved. Six were valid and fixed, and one was partly valid: the route list stays out of the fingerprint by design. The fixes include: the route manifest moved to placeholders, failed axe scans became a metric, the fixture database is recreated on each run, 2 uncovered detail pages were crawled, override matching extended to child routes, treasury lookups, and the run fingerprint. Codex reached its usage limit on the latest heads |
| **Evidence integrity** | Fixes to the state probe were re-run, not only described. 10 shell-endpoint routes and 4 child routes were re-probed, then a full pass ran with automatically derived overrides (103 routes, 206 runs). The only additions were PROBE-01 (P1) and PROBE-02 (P2); no other verdict changed |
| **P0 code verification** | All 9 P0 rows were checked against the cited files and lines on the current tree, by the coordinator and again by the independent reviewer |
| **Links** | All relative links in the H2 documents resolve (checked by script) |
| **A1 merge** | #1516 merged as `24528be` after CI was green on the final head (sqlite, pgsql, CI Gate), with PRE_MERGE_REVIEW: PASS. POST_MERGE_REVIEW is recorded on #1516 once `main` CI completes |

## 4. AWJ Core (third v3 theme)

AWJ Core was merged during phase A (#1522 → `0d7bded`, D-41, `THEMES.md` §6A). It changes the colour of **the shell's two bars only**: Light `#1E40AF`, Dark `#4F8CFF` with dark text. Its scope is Ledger only. A separate task is tuning its Dark-mode colours, so **Core Dark is provisional**.

Updates made in this PR:
- **Plan §5 and §8 #5 (visual verification matrix):** Default in every capture. Core Light is sampled in every slice touching the shell or shared components (B1–B5) and in every C wave. Ink is sampled as before. **Core Dark is evidence, not a gate**, until its follow-up closes. Floor and Studio are verified on Default only.
- **A2 §10:** what Core owns (tokens, generator, generated CSS, theme library, pre-paint script, selector, strings) and the rule that H2 never edits those. Theme-sensitive findings to re-check on Core in B1. A pre-B check of the theme task's state.
- **A4 §4 #5:** the theme matrix is part of every slice's acceptance.
- **Phase A evidence predates Core:** it was all captured on Default. No finding depends on the theme, because Core changes only the shell.

## 5. Dependencies outside H2 (not fixed here)

| ID | What | Type |
|---|---|---|
| OPS-01 | POS checkout returns 422 for every product without a unit template (`InvoiceService.php:546` → `UnitConversion::resolve`) | **Backend, urgent** |
| OPS-03 | `ReportService::partnerStatementSourceRoles` ignores refunds, so the statement balance is wrong | **Backend, urgent (financial)** |
| PLT-03, FIN-03, OPS-09/15, SAL-14 | Company field cannot be cleared; aging takes no period; opening preview disagrees with posting; credit note and return round differently | Backend |
| PLT-06, FIN-24, FIN-22, OPS-13/14 | Server values R-MONEY-2 needs but no endpoint provides (dashboard KPIs, group balances, treasury movements, provisional stocktake value and permit cost) | Backend |
| SAL-09 | Pause and edit of recurring invoices (stop uses the existing `DELETE` and rides C1) | Backend |
| SAL-08, SAL-13, OPS-32, FIN-23, FIN-21, PLT-07 | Remaining amount after CN/returns, branch scope of balances and stock, custody accounts, payment-method reach, applications display | Owner policy / ADR |
| `name_en` | D-ERP-UX-01 | Separate, unchanged |

## 6. Not verified (phase A)

- Legacy surface for most workflows.
- 200% zoom.
- Firefox and WebKit (Q1).
- Real screen readers and devices.
- Real login (rate limit shared by the auditors).
- Fuel sale, receiving and reconciliation: `bcmath` is missing locally; these paths are green in CI.
- Studio publish, and document extraction (no worker).
- POS returns, exchange, drawer, offline and printing.
- Many-row states outside Sales.
- **AWJ Core in any phase A capture**, because Core postdates it.

The probe fails a shared endpoint together with the page's own data, not on its own; the README records this limitation.

## 7. Decision Gate — requested from the owner

1. **P0 hotfix (UI only, outside D3, all-surfaces):** should A2 §3 items 1–7 ship as one small slice now? Merge ≠ deploy.
2. **Separate backend task:** should OPS-01 and OPS-03 get their own task, with a full `php artisan test` run and the journal tables CLAUDE.md requires?
3. **O-14:** treat all 13 Fuel screens as Ledger for H2.
4. **Policy questions:**
   - SAL-08: invoice remaining after credit notes and returns.
   - SAL-13 and OPS-32: branch scope of dashboard balances and warehouse stock.
   - FIN-23: which accounts a custody settlement may use.
   - PLT-07: how the applications page displays grandfathered tenants.
5. **Approve A4** as the H2 rulebook, including the theme matrix.
6. **Launch B then C:** B5 widened to every irreversible action, and B4 first. The pre-B check of the AWJ Core follow-up applies.

**Stop:** no phase B or C, no P0 fix, no v3 default enablement and no deploy before the owner's explicit approval.
