# AWJ-COMMERCE-VISUAL-DIMENSIONS-H1 — Final Horizon Report

STATUS: **CLOSED ENGINEERING-WISE (2026-10-15) — not released.** Production verification and a real Staging pass were **not** performed and need separate owner approval. No deploy and no environment change was made.
OWNER INSTRUCTION: close with the minimum necessary work; no new horizon, no new features; no Deploy/Production without explicit approval.

## 1. What was delivered (all merged to `main`)

| Slice | PR | Merge SHA |
|---|---|---|
| VD-0 evidence/architecture · VD-1a contract · VD-2 shape engine · VD-4a display keys | — / — / #1482 / #1490 | `d5dfa16` · `8801af9` · `d568bf6` · `c57f4be` |
| VD-1b storage + admin API · VD-1c public projection + guarded image route | #1491 · #1499 | `5a10930` · `b1b7988` |
| VD-3 admin visual editor · VD-4b storefront renderer · VD-4c builder controls | #1509 · #1508 · #1507 | `d628288` · `f1e309e` · `2b77747` |
| VD-5 QA: fixes | #1521 D-S-1 · #1527 D-S-2 · #1528 D-S-3 · #1529 D-W-1 · #1530 D-W-4/8/2 · #1533 owner report | `6b1d3a2` · `3f445a9` · `de2a13b` · `74cc76f` · `2f6569b` · `ed7f873` |
| VD-5 QA: specs, reports | #1525 · #1526 · #1536 | `cf59e46` · `a86a78b` · `29d3288` |
| Backlog | BL-001 analysis #1534 · BL-002 follow-ups (this PR) | `a79b157` |

Every slice was reviewed by an independent reviewer before merge; post-merge CI on `main` (PHP sqlite + pgsql, Web CI, Storefront CI) was green for every PR above. No change to API contracts, database, permissions, security rules or accounting was made after VD-1c.

## 2. Acceptance check (owner's requirements)

| Requirement | Status | Evidence |
|---|---|---|
| Visual identity per facet value: image / icon / text, 12 shapes | Met | VD-2, S-2 (12 shapes × image/icon/text, painted pixels vs masks), W-2 |
| Admin editor with live preview, per-property inheritance | Met | VD-3, W-1…W-3, W-8b; preview sizes fixed (#1529) |
| Storefront display styles and templates (5 layouts, 7 templates, per-device columns, RTL/LTR) | Met | VD-4b, S-1 (14,864 checks), S-3 legacy byte-identical |
| Store builder section customisation, same dimension in two sections without leakage | Met | VD-4c, W-7 (21/21), S-5 |
| Builder preview shows real data (owner-reported) | Met after fix | #1533, before/after in `AWJ-VD-5-QA-REPORT.md` §6 |
| Tenant isolation, sales-channel isolation, RBAC, guarded images, cache window | Met | S-6 (114 checks), W-9, S-8 real 312 s timeline, D-17/D-16 tests |
| Accessibility (keyboard, focus, names, contrast), performance | Met for what was measurable | S-9 re-run on merged `main` after the fixes: **36/36 PASS**; S-11 |
| Backward compatibility | Met | S-3, golden markup tests, legacy documents byte-unchanged |
| Full chain in a real browser | Met on a local stack | VD-5 report §2–§3 |

## 3. The 11 storefront checks (S-1…S-11)

10 passed on first run. **S-9 (keyboard/a11y at 390 px) was the only failure**: D-S-2 (clipped carousel focus) and D-S-3 (bottom bar covering focus). Both were fixed and proven per defect in Chromium (before/after). For this closure S-9 was **re-run in full on merged `main`: 36/36 PASS**. Note: the first re-run showed the old failure because the local Next dev server served a stale CSS bundle; after clearing `.next` the computed `scroll-padding-bottom` is 64 px and no stop is covered by the bottom bar (two remaining "covered" probes are a dev-overlay portal and an off-screen element, not user-visible focus loss). Result: **11/11 pass**.

## 4. Critical defects

None open. No defect prevents visual dimensions from working. Open items are backlog (below).

## 5. Remaining (not blocking closure)

- Backlog: `docs/engineering/backlog/BL-002-visual-dimensions-followups.md` (G1–G5, residuals) and BL-001 (G6, analysis delivered, awaiting approval).
- **Not done, needs separate approval:** Staging pass on real infrastructure; Production verification/release.
- Not verified: real screen reader, production build/hydration, real R2/CDN/custom domains, physical iOS safe-area, Safari/Firefox (see VD-5 report §8).
- Test specs added (#1525/#1526) run only against a live stack (`VD5_STACK_ENV`), not in CI.

## 6. Pointers

`AWJ-VD-5-QA-REPORT.md` · `awj-vd-5-qa-evidence/` · `AWJ-VD-H1-TASK-QUEUE.md` · `docs/engineering/backlog/`.
