# P3-A-05 — Global Gradient Publish Gate — Report

**Verdict: READY** for owner review — same PR (#1587), not merged, not deployed.

| | |
|---|---|
| PR | https://github.com/safwan5001-source/Nebrax/pull/1587 (updated in place; no new PR) |
| Branch | `p3-a-05-advanced-background-editor` |
| Base (`main`) | `fd2822e46e9df35ff139e1155fd9963547932e02` (main was merged into the branch: clean, no conflicts) |
| CI-validated Head | `7bff0c43ea3fb2a37ab65025139f558a137625e7` |
| Previous Head | `87bc2a86c0e5f04161f65647a48d0d4417816b87` |

> The commit that adds this report is documentation-only and is not the CI-validated Head. All CI results below belong to `7bff0c4`.

## 1. The gap — proven before any fix

Reading the validators: the only reference to the document-level `background` in any publish gate is the media gate. `SectionDesignContrast` judges text against the legacy `backgroundColor`; nothing reads a global gradient.

`StorefrontPresentationGlobalGradientGateTest` was written first and run against the unfixed code:

| Test | Before the fix |
|---|---|
| Contrast gate on a dark **solid** page + dark text | catches it |
| Same unreadable page painted as a dark **gradient** | **not caught** (`SectionDesignContrast::errors` = `[]`) — the characterisation test passes, proving the gap |
| Legacy publish, version publish, schedule, scheduled execution of a gradient | **200 / accepted / published** (5 gate tests failed) |

So a dark gradient under dark text could be published, scheduled and executed.

## 2. The fix

`StorefrontPresentationPublishValidator::globalBackgroundErrors` — a gradient branch next to the media branch (14 lines added, **0 removed**): a global `kind: gradient` ⇒ `422 global_gradient_background_not_ready` at path `background`.

All four publish paths go through this validator (`assertPublishable` at legacy publish, version publish and schedule creation; `errors()` at scheduled execution), so one gate covers them; each is tested.

| Requirement | Result |
|---|---|
| Gradients save and preview in drafts | PUT/draft round-trips the gradient; canvas and panel preview unchanged |
| Clear merchant message | Note under the gradient in the editor (AR/EN); `describePublishIssues` turns the code into a specific sentence on publish *and* schedule |
| `global_media_background_not_ready` unchanged | The media branch has no diff; its test and message are unchanged |
| Solid colour unaffected | legacy colour and an authored solid object publish; schedule accepted |
| Section-level gradients unaffected | a hero with a design-level gradient passes the validator exactly as before |
| Previous Published Snapshot kept on rejection | asserted for legacy, version, schedule and scheduled-run: `published_config`, `active_version_id`, `published_revision` untouched; at scheduled execution the pointer stays (`OUTCOME_VALIDATION_REJECTED`) |
| Removing the gate later | Tripwire in the characterisation test: when P3-A-06 makes the contrast gate judge global gradients, that assertion flips and the gate must be removed in the same change |

Two consequences of this change that are intentional and worth knowing:
- A tenant that already has a global gradient in its **published** snapshot keeps serving it (nothing rewrites the snapshot), but cannot publish a *new* version while that gradient is still in the draft.
- A version scheduled with a gradient **before** this gate existed is rejected when it comes due (fail-closed) and the published snapshot is kept.

## 3. Files changed in this slice (since `87bc2a8`)

| File | Change |
|---|---|
| `app/Support/Commerce/StorefrontPresentationPublishValidator.php` | gradient branch (+14) |
| `tests/Feature/StorefrontPresentationGlobalGradientGateTest.php` | new, 7 tests |
| `tests/Feature/StorefrontPresentationPublishApiTest.php` | the test that asserted "gradient publishes normally" replaced by a solid-colour publish test |
| `web/.../GlobalBackgroundField.tsx` | gradient draft-only note; image note given an explicit marker |
| `web/.../messages.ts` | 2 new AR/EN keys; the image notes no longer suggest a gradient as a way to publish |
| `web/.../announcement-status.ts` | maps `global_gradient_background_not_ready` |
| `web/.../__tests__/GlobalBackgroundField.test.tsx`, `ExperienceBuilder.globalBackground.test.tsx` | new/updated tests |
| `web/e2e/p3-a-05-global-background-editor.spec.ts` | asserts the gradient note |
| `docs/p3-a-05-visual-qa/*.png` | evidence refreshed; `en-2-gradient.png` added |
| `P3-A-05-IMPLEMENTATION-REPORT.md` | stale statements corrected |
| merge commit | `origin/main` (AI-ACTIONS-06A/06B; no overlap) |

## 4. Tests and results

**Targeted**

| Suite | Result |
|---|---|
| PHP `StorefrontPresentationGlobalGradientGateTest` | 7/7 (before the fix: 5 fail, 2 pass) |
| PHP `StorefrontPresentationPublishApiTest` | pass (image gate tests untouched) |
| PHP presentation family (`StorefrontPresentation*`, `SectionDesign*`, `StorefrontBackground*`, header/footer/media/announcements) | 535 pass, 3 skipped, 0 fail |
| Web new/updated tests | pass; mutation check (gradient code no longer mapped) fails 2 of them |
| Full web Vitest | 663 files / 7835 tests pass |
| Web production build | pass |
| Visual QA (Playwright, AR/EN desktop + AR 390 px) | 3/3 pass; screenshots reviewed |

**Full local `php artisan test`** — the first run (before this change) finished 7930 pass / 26 fail, all in six `Fuel*` classes with `Call to undefined function bcmul` (the `bcmath` extension is not installed in this sandbox). The run after this change was interrupted by a session restart at 1844 passed / 0 failed; a re-run was started and is not required for the verdict because GitHub CI runs the complete suite on both databases (below).

**GitHub CI on `7bff0c4`** — all 7 check runs `success`: CI Gate, php artisan test (sqlite), php artisan test (pgsql), web build (two runs), merchant preview visual QA, published footer visual QA. PR `mergeable_state: clean`. The storefront job did not run (no storefront file changed).

## 5. Remaining risks

- **The gate is blunt by design:** every global gradient is blocked, including ones that would be perfectly legible. That is the safe temporary behaviour until P3-A-06 can prove contrast.
- **Image notes changed wording** (they no longer offer a gradient as a publishing option); the existing image tests still pass.
- Risks from the first report still stand: switching away from Image discards its configuration (Undo recovers it), Solid is hex-only, the new Playwright spec is not wired into a CI workflow, and no Codex/human review has run yet (Codex hit its usage limit).

## 6. Recommended next step

Owner review of PR #1587, then merge at the owner's direction. P3-A-06 should make the contrast gate judge global gradients and images and remove both temporary gates; the tripwire test marks the exact assertion to flip.

## Restrictions honoured

No merge, no deploy or release, no new PR, `global_media_background_not_ready` untouched, no schema/API/route change.
