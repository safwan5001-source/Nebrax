# P3-A-04 — Final Sync & CI Validation Report

**Verdict: READY** (for owner review; PR remains Draft, not merged, not deployed)

| | |
|---|---|
| PR | https://github.com/safwan5001-source/Nebrax/pull/1570 |
| Branch | `p3-a-04-global-background-renderer` |
| Base (`origin/main`) | `0b2f127733eb06b6c85ebf3bd9dda2b3df4884da` |
| CI-validated Head | `e501e50f720597c083a4315da5d2bf7808966648` |
| Previous Head | `42dd073cea32a9b13a27312ffd1258f4a3cf7785` |
| Previous merge-base | `8c74051b5e6d0c917babf97902954c1dc9b16ee2` |

> The commit that adds this report is documentation-only and is therefore **not** the CI-validated Head. All CI results below belong to `e501e50`.

## 1. Changes performed

1. Fetched refs and checked out the existing PR branch. Working tree was clean; branch was 21 commits behind `origin/main`, 8 ahead.
2. Merged `origin/main` into the PR branch (merge commit `c811a68`). **No conflicts. No force-push. No history rewrite.**
3. Removed one `biome-ignore lint/performance/noImgElement` comment in `storefront/src/components/layout/GlobalBackgroundLayer.tsx` (commit `e501e50`). Biome does not raise that rule for an `<img>` inside `<picture>`, so the suppression raised `suppressions/unused`. Comment-only; no behaviour change.
4. No feature code was reimplemented.

## 2. Files modified in this sync

| File | Change |
|---|---|
| `storefront/src/components/layout/GlobalBackgroundLayer.tsx` | −1 line (unused suppression comment) |
| `P3-A-04-FINAL-SYNC-REPORT.md` | new (this report) |
| *(21 commits from main)* | brought in by the merge; not authored here |

## 3. Conflicts resolved

None. Of the 191 files changed on main since the old merge-base, exactly one overlaps the PR:
`web/src/modules/store-experience-builder/StorefrontPreviewCanvas.tsx` (main: product-card/preview-media parity work). It auto-merged. I verified the PR's four hunks are intact in the merged file: the `resolveStorefrontBackgroundStyle` import and its spread into `vars`, the `GlobalBackgroundBackdrop` import and render with `viewport`, and the `isolate` class on the root.

## 4. Tests and results (local, on the merged tree)

| Check | Result |
|---|---|
| Storefront targeted (layout, `GlobalBackgroundLayer`, `storefront-background-render`) | 6 files / 28 tests passed |
| Web targeted (`GlobalBackgroundBackdrop`, `storefront-background-render`, `StorefrontPreviewCanvas*`) | 15 files / 131 tests passed |
| Storefront full Vitest | 214 files passed, 15 skipped; 2939 tests passed, 15 skipped (none of the skips are in PR files) |
| Web full Vitest | 658 files / 7767 tests passed |
| Storefront Biome (`pnpm check`) | exit 0; no findings in PR files (remaining warnings are in `header-overlay.ts`, `AnnouncementBar.test.tsx`, `CategoriesSection.display.test.tsx`, none touched by the PR) |
| Storefront locale parity | passed |
| Storefront `tsc --noEmit` | passed |
| Web production build (includes type check) | passed |
| Storefront production build | passed |
| Visual QA (`web/e2e/store-brand-qa.spec.ts`, global background, desktop project) | passed; screenshots reviewed |

Visual QA observations: desktop shows the indigo still, mobile shows the different orange still (per-viewport source selection), overlay visible, header and footer intact. The "Issues" badge in the screenshots is the Next dev overlay; the fixed bottom nav on mobile is a full-page-screenshot artifact. Neither relates to this PR.

Environment notes: web has no Biome config (Biome runs for `storefront/` only). The first Playwright attempt failed because the installed Playwright expected a newer Chromium build than the sandbox provides; I reran with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` pointing at the installed Chromium. No test was altered, skipped or weakened.

PHP was not run locally (no Laravel `vendor` in this sandbox; the repo builds it via CI). The PR changes no PHP; PHP is covered by CI below.

## 5. Build and CI status — Head `e501e50`

All 11 check runs completed with `success`; PR `mergeable_state: clean`.

| Check | Conclusion |
|---|---|
| php artisan test (L11, sqlite) | success |
| php artisan test (L11, pgsql) | success |
| CI Gate | success |
| web build (Next.js) ×2 | success |
| storefront (lint + typecheck + test) ×2 | success |
| merchant preview visual QA | success |
| published footer visual QA | success |
| ZATCA SDK conformance (advisory) | success |
| ZATCA SDK harness self-test (advisory) | success |

No job failed, so no log inspection or fix cycle was needed.

## 6. Security invariants verification

| Invariant | Evidence | Status |
|---|---|---|
| `global_media_background_not_ready` still blocks publishing global media backgrounds | Present, unchanged, in `app/Support/Commerce/StorefrontPresentationPublishValidator.php` (returns it for any `kind: media` background); PHP publish API test passes on sqlite and pgsql in CI | Held |
| Tenant isolation and media ownership checks | Diff vs main touches nothing under `app/`, `database/`, `routes/`, `tests/`, `config/` | Held |
| Still-only rendering | Renderers contain no video/animated paths; both assert zero `<video>`; animation-preview store is not used | Held |
| `SectionBackground` contract | No related or `contracts/` files in the diff | Held |
| No persisted signed media URLs | Preview URL comes from `useMediaRefPreview` at runtime, rendered into `<img src>`, never written to config | Held |
| `backgroundColor` backward compatibility | Existing `presentationCssVars(... backgroundColor)` call left in place; background style is spread after it, additive | Held (by code reading and existing tests; no dedicated visual check of a `backgroundColor`-only config) |
| No schema or unrelated API changes | No files under `database/`; no PHP changes | Held |

## 7. Remaining risks

- **Limited merge-time cross-check of main's preview changes.** Main's product-card and preview-media changes to `StorefrontPreviewCanvas.tsx` merged cleanly and all tests and builds pass, but there is no dedicated test of the backdrop interacting with those new card paths. Low risk: the backdrop is an absolutely-positioned `aria-hidden` layer at `z-index: -1` inside an `isolate` root.
- **Published media path is gate-protected, not exercised end-to-end.** Because the publish gate blocks global media backgrounds until P3-A-06, the published renderer's media branch is covered by unit tests, not by a real published document.
- **Local PHP not run.** Relies on CI (green).
- **PR hygiene:** the PR is still Draft with a `[WIP]` title, and its description still says "GitHub checks for the updated head are pending" with Base `8c74051`. These are stale; I did not edit them. Dev-only note: pre-existing Biome warnings elsewhere in `storefront/`.

## 8. Recommended next action

Owner review of PR #1570. If approved: update the PR description (Base/Head/CI status), retitle and mark ready for review, then merge at the owner's direction. Do not start P3-A-05 until the owner approves.

## Restrictions honoured

No new PR, no merge of #1570, no deploy or release, no work on P3-A-05.
