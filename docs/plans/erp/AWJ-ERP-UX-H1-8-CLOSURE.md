# AWJ-ERP-UX-H1-8 — Closure report

STATUS: **HORIZON CLOSED** (all slices merged; nothing deployed)
DATE: 2026-10-14 · Executor: Claude Code · Owner: Safwan
State file: [AWJ-ERP-UX-H1.md](./AWJ-ERP-UX-H1.md) · Audit: [H1-0](./AWJ-ERP-UX-H1-0-AUDIT.md) · Contract: [H1-1](./AWJ-ERP-UX-H1-1-UI-CONTRACT.md) · Slice reports: [`reports/`](./reports/)

> **Merged ≠ Deployed ≠ Production verified.** Every change in this horizon is merged on `main` only. No deploy, release, migration or production operation was performed or implied.

## 1. Outcome

24 PRs (3 documentation PRs including this closure, 20 implementation slices, 1 test-only fix), each with exact-head CI green, a full Vitest run on the exact head, and a recorded `PRE_MERGE_REVIEW: PASS` / `POST_MERGE_REVIEW: PASS` with the merge SHA. All P1/P2 backlog items are fixed and verified in a real browser; P3 items are fixed or carry a recorded disposition (§5). No accounting, VAT/ZATCA, money/rounding, pricing, balance, inventory posting, tenant/branch visibility, auth/RBAC, database, public API or infrastructure change was made in any slice.

Headline effects measured on the same 208-route manifest (H1-0 baseline → final `main`):

| What users get | Before | After |
|---|---|---|
| Pages with a focusable element inside a hidden menu (`aria-hidden-focus`) | 169 | **0** |
| Pages that scroll sideways at 320 px | 167 | **0** |
| Pages whose heading outline skips a level | 93 | **0** (1440, 390 and 320; v3 and legacy) |
| Routes with unnamed selects / inputs / buttons | 15 / 15 / 4 | **0 / 0 / 0** |
| Modal dialogs: Tab presses escaping to the page (of 40) | 31 | **0** |
| Toast region at 320 px | 16 px off-screen | inside, 16 px margins |
| Dark-mode document preview and print: VAT no., dates, city | invisible (1.1:1) | **readable** |
| Contrast failures on audited routes | 515 nodes | **0** |
| Raw message keys / `MISSING_MESSAGE` | 1 page | **0** |
| Median page load to settled (local, 1440 AR) | 1,332 ms (p90 1,864) | 1,245 ms (p90 1,410) — indicative only, same machine, not a benchmark |

## 2. Slice ledger

Full table with PR numbers and merge SHAs: [state file](./AWJ-ERP-UX-H1.md#slice-status). Order merged: H1-0 `276ebef` → H1-1 `69e9ffe` → 2A `6581e58` → 2B `0902fd0` → 3A `d9dbeaf` → 3C `ca652ff` → 3B `a90b3f9` → 4A `45092a9` → 4B `fa3166f` → 4C `b222da8` → 5A `42c8b1c` → 5C `c6ca972` → 7A `29a2316` → 7C1 `cc490d6` → 6A `4ca1ece` → test fix `ccf0be2` → 2C `9c50ead` → 5B `b8f3453` → 6B `317d04d` → 7B `3093e10` → 7D `7888cdf` → 7E `622783e` → 7F `ea7c0c3`. (`af82fcb`, #1411, is an unrelated delivery-connectors change merged by others in between.)

## 3. Verification performed on final `main`

1. **Full regression crawl** of the 208-entry manifest on `7888cdf` (all slices up to H1-7D): v3 AR 1440, EN dark 1440, AR 390, AR 320; legacy AR 1440; restricted **staff** role AR 1440 — 1,248 page loads with axe-core 4.10.2, overflow, heading outline, landmarks, console errors, failed API calls and message-catalog checks. Matrix: [h1-8-evidence/REGRESSION-MATRIX-7888cdf.md](./h1-8-evidence/REGRESSION-MATRIX-7888cdf.md).
2. **Behavioral probes** from every slice re-run against final `main` (dialog focus/Tab/Escape, menu `inert`, toast bounds at 320/390/1440, skip link, 320 px header and 44×44 menu, "soon" entries and network idle, product edit overflow, row-action headers, bidi isolation, KPI fit at 320/360/390, localized forbidden state, EN list chrome, numbering labels): all as recorded in their slice reports.
3. **Residuals** left by that crawl were fixed in H1-7E/H1-7F, and the **final tree** (`main` `622783e` + H1-7F head; `main` after #1441 is `ea7c0c3`, which additionally contains the unrelated #1411 — the combined tree passed the full Vitest suite, 569 files / 6,088 tests) was re-crawled in full: v3 AR 1440, EN dark 1440, AR 390, AR 320 and the staff role (1,040 loads). Result: `heading-order`, `link-in-text-block`, `color-contrast`, `scrollable-region-focusable`, overflow, missing messages and raw keys are **0 everywhere**; the only axe findings left are `/icon.ico` (an image route, not a page) and `target-size` on the labelled "Already paid" checkbox (WCAG 2.5.8 equivalent-target exception). Matrix: [h1-8-evidence/REGRESSION-MATRIX-FINAL.md](./h1-8-evidence/REGRESSION-MATRIX-FINAL.md); the intermediate `7888cdf` crawl: [REGRESSION-MATRIX-7888cdf.md](./h1-8-evidence/REGRESSION-MATRIX-7888cdf.md).
4. **Combined-tree test runs:** before merging the last implementation slices, `main` + 7B + 7D was merged locally and passed the full Vitest suite (567 files / 6,081 tests); every PR's exact head passed its own full run (numbers on each PR).

## 4. Restricted role (staff, 15 permissions)

Final tree: 208 loads, 0 pages with sideways scroll, 0 raw keys, 0 missing messages, every page has exactly one `h1` except `/document-qa` (internal document QA harness) and `/icon.ico`. 403 responses (80 calls) are the server refusing what the role may not see; the UI shows the localized forbidden state. The `7888cdf` crawl found six access-denied pages without a heading (Accounting Settings ×4, Developers keys/webhooks) → fixed in H1-7F; the first fix briefly produced a second `h1` on three Developers pages for restricted users, caught by the re-crawl and corrected before merge (gate title is `h2` under a page header). Sidebar items follow the role (unchanged). The staff role was exercised read-only.

## 5. Backlog disposition (ERP-UX-001 … 027)

| ID | Pri | Disposition | Slice |
|---|---|---|---|
| 001, 002 | P1/P2 | Fixed, verified | H1-2A |
| 003 | P2 | Fixed, verified (169 → 0 pages) | H1-2B |
| 004 | P2 | Fixed, verified | H1-2C |
| 005, 006, 021 | P2/P3 | Fixed, verified | H1-3A |
| 007 | P2 | Fixed, verified | H1-3B |
| 008 | P2 | Fixed, verified | H1-7A |
| 009 | P2 | Fixed, verified (applied also to Fuel settings in H1-7D) | H1-5A |
| 010 | P2 | Fixed, verified (68 → 0 nodes) | H1-5B |
| 011, 012 | P2 | Fixed, verified; plus the dark-mode document paper defect found while fixing 011 | H1-6A |
| 013 | P2 | **Owner decision pending (D-ERP-UX-01)** — reports show Arabic account names in English because the API has no `name_en`; needs an additive API field | — |
| 014 | P3 | Fixed, verified (93 → 0) | H1-7B, H1-7F |
| 015, 016 | P3 | Fixed, verified | H1-4A |
| 017 | P3 | Fixed for finance, accounting and HR (31 sites); remaining native confirms recorded (products, price lists, POS, Fuel master data, Commerce/Customizer) | H1-6B |
| 018 | P3 | Fixed, verified | H1-7E |
| 019 | P3 | Fixed, verified | H1-7D, H1-7F |
| 020 | P3 | Fixed, verified (also made the Customizer chevron visible) | H1-7E |
| 022 | P2 | Fixed on product edit; the two payment forms' `sr-only` inputs produce no overflow and were left as recorded in H1-1 §2.7 | H1-4B |
| 023 | P3 | Fixed, verified (incl. Fuel settings endless skeleton, localized 404) | H1-7D |
| 024 | P2 | Fixed, verified | H1-5C |
| 025 | P2 | Fixed on the main lists; remaining Arabic literals verified to be bilingual ternaries, data or intentional fallbacks | H1-7C1, H1-7D |
| 026 | P2 | Fixed, verified | H1-3C |
| 027 | P2 | Fixed, verified | H1-4C |

## 6. Residual risks and open items (owner attention)

1. **D-ERP-UX-01** (ERP-UX-013): additive `name_en` on report account rows — API change, outside this horizon's authority.
2. **`nav-state` has no `sales.invoicing` key**: the sidebar still shows Delivery Notes to a tenant whose entitlement returns 403 (the page now explains it). Backend/catalog decision.
3. **Recurring Postgres test flake** (needs a backend owner): `CreditNoteSourcePostgresTest::the_restrict_rule_rolls_back_to_set_null_and_forward_again` deadlocked **twice** in CI on web-only PRs (#1433, #1441) — DDL (`ALTER TABLE credit_notes … DROP/ADD CONSTRAINT`) in migration `2026_11_04_020000_restrict_credit_note_original_invoice_delete.php` racing a concurrent row lock. Passed on re-run each time. Not caused by this horizon; it can turn any PR's CI red at random.
4. **Test interaction found and fixed**: H1-4C + H1-5C each passed alone but broke one test together on `main`; fixed by #1436 within minutes. Process change applied for the rest of the horizon: merge `main` into open PRs and run the full suite on the combined tree before merging.
5. Remaining native `window.confirm` outside finance/HR (ERP-UX-017 tail), the labelled "Already paid" checkbox (`target-size`, WCAG equivalent-target exception), the walk-in customer default name stored in Arabic (data, not chrome), and Arabic tenant data in English mode (correct behavior).
6. Automated code review (Codex) was unavailable (usage limit) for every PR after H1-0; reviews were performed by the executor at exact heads and recorded on each PR.

## 7. Not verified (explicitly)

- Real screen readers (NVDA, JAWS, VoiceOver, TalkBack) — all accessibility evidence is axe-core plus scripted keyboard/DOM probes.
- Browsers other than Chromium (Firefox, WebKit/Safari) and physical devices (iOS safe-area, Android).
- Physical printers and PDF export from dark mode (print-media colors verified in Chromium only).
- Production or staging environments, real tenant data volumes, performance under load. Load times above are local and indicative.
- The restricted role was exercised read-only.

## 8. Recommendation

Close AWJ-ERP-UX-H1. Next candidates (each needs its own owner-approved scope): D-ERP-UX-01 API field; `nav-state` coverage for entitlement-gated modules; finishing ERP-UX-017 in products/POS; screen-reader and cross-browser pass before a production release.
