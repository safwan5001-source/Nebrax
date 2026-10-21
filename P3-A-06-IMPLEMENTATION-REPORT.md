# P3-A-06 — Global Background Contrast & Publish Safety — Implementation Report

**Verdict: READY FOR OWNER REVIEW** — both Checkpoints delivered; both temporary gates are replaced by one tested policy. PR open, not merged, not deployed.

| | |
|---|---|
| Branch | `p3-a-06-global-background-contrast` |
| PR | https://github.com/safwan5001-source/Nebrax/pull/1590 |
| Base when branched | `17822a180dc37d74fc824de51f9e60a8fb262604` (PR #1587 merge) |
| Base now (`main`) | `2696f53751a80368b067847310efbbc41899d575` (moved after branching; see §8) |
| Code Head (CI-validated) | `30641d348e1622afd62ca6af4d97ded353e5ffdf` |
| Checkpoint A commit | `a9a6b86` |

> The commit that adds this report is documentation-only. All results below belong to the code head `30641d3`.

## 1. Risk matrix (before coding)

| # | Risk found in the existing architecture | Severity | Resolution |
|---|---|---|---|
| R1 | `SectionDesignContrast` judges a section's text against its own surface or the legacy `backgroundColor`; it **never reads the document-level `background`**. A dark global gradient or picture was therefore unproven under any text. (P3-A-05 follow-up had to block both with temporary codes.) | High | New `GlobalBackgroundContrast` judges the actual paint. |
| R2 | Foreground colours that render on the page paint are not a per-section input; they are fixed storefront tokens (`#111827`, `#636a78`) plus the merchant's brand link colour. | High | The policy judges exactly those, plus explicit text of page-bound sections. |
| R3 | A gradient's luminance can dip in the interior while both ends pass (luminance is convex along a line). | Medium | `gradientInterval` samples the line and widens by a proven bound; test on an interior dip. |
| R4 | Picture evidence is per usage; the global layer has a desktop **and** a phone picture, an overlay, and the `backgroundColor` fallback that shows while loading. | High | Union of both pictures' bounds, composited with the overlay, united with the fallback interval. |
| R5 | Animated GIF/WebP assets are accepted by the library (AMEND-22); their later frames have no pixel evidence. | High | Rejected explicitly with their own code; resolver never serves an animation to the global layer. |
| R6 | Four publish paths (legacy, immediate version, schedule, scheduled execution) must stay equivalent and side-effect-free on rejection. | High | One validator, one trait-driven test matrix asserting nothing moves on any path. |
| R7 | Cross-tenant media id in a background. | High | Evidence and animation lookups are `BaseModel`-scoped; the ownership/readiness gate is unchanged. Test with a foreign id. |
| R8 | Saving an invalid authored `background` threw an uncaught exception → **500** (pre-existing since P3-A-02). | Medium | Both save controllers now return 422 with the validation payload (one adjacent change, flagged). |
| R9 | The presentation-layer firewall test forbids the validator naming model classes. | Medium | The animated lookup lives in the allow-listed `StorefrontMediaContrastEvidence`; the firewall was **not** loosened. |

## 2. Gradient gate — status: **REPLACED**

`global_gradient_background_not_ready` no longer exists anywhere. A global gradient publishes only when the policy proves it.

| Aspect | Behaviour |
|---|---|
| Colour resolution | Hex or palette role resolved against the approved palette; anything unresolved ⇒ `global_gradient_colour_unresolved` |
| Judged range | Whole luminance interval (both ends, mid colours, interior dip); direction and RTL/LTR do not enter |
| Foregrounds | `text #111827`, `muted #636a78`, brand `primaryColor`; AA threshold 4.5 |
| Page-bound section text | Explicit `body`/`heading`/`link` colours of **visible** sections with no own surface ⇒ `global_background_text_contrast_insufficient` at `homepage.sections[i].design.text.<field>` |
| Independent | Sections with their own `design.background`; `hero`/`appPromo`/`wholesale`; `banner`/`deliveryPromise` |
| Codes | `global_gradient_contrast_insufficient`, `global_gradient_colour_unresolved` |

## 3. Media gate — status: **REPLACED** (Checkpoint B proven secure)

`global_media_background_not_ready` no longer exists in PHP (the web client keeps a message mapping only for an older server).

| Rule | Enforcement |
|---|---|
| Tenant ownership and readiness | Unchanged `StorefrontMediaPublishGate` (`media_missing`, not ready ⇒ rejected); evidence lookups are tenant-scoped |
| Still-image derivatives | Evidence comes from the still derivative of the asset |
| Animated assets | `global_media_animated_unsupported` (checked first, so the merchant gets the real reason); resolver drops `animation` for `background.media`/`background.mobile` only — section pictures keep theirs |
| Focal / overlay | Overlay alpha stays in the approved 5..90 step 5 set (invalid ⇒ 422 on save); focal is a physical 0..100 point; both are in the verdict (overlay) or neutral (focal) |
| No URLs / CSS / signed links | Document stays id-only; unchanged normalizer; round-trip tests assert no `http`, `url(`, gradient CSS |
| No new endpoint | The editor reads the existing `derivatives/status` and asset endpoints |
| Worst-case policy | Desktop ∪ phone pixel bounds, under the overlay, ∪ `backgroundColor` fallback; missing/stale/translucent/unmeasured ⇒ `global_media_contrast_unproven`; weak ⇒ `global_media_contrast_insufficient` |
| Dark overlays | Can never prove the dark page text; only a **light** overlay can rescue a picture |

**Practical limit (by design):** the muted token needs a background luminance of about 0.82, so only very light imagery, or light imagery under a strong light overlay, can publish. Dark photographs stay draft/preview-only. The editor says so and offers the weakest sufficient light overlay as an explicit action (never applied silently); for a picture no overlay can rescue it says "choose a lighter one".

## 4. Equivalence across publish paths

`GlobalBackgroundPublishPaths` runs each case on **legacy publish**, **immediate version publish**, **schedule creation** and **scheduled execution**. A rejection must leave the Published Snapshot, revision numbers, the draft and the schedule byte-identical (`assertSnapshotUntouched`), and an accepted background must be the same on all four. Idempotent re-execution of a due schedule and the stale/cancelled/rescheduled-job suites still pass unchanged.

## 5. Merchant UI

- Gradient panel: `ready` (role=status) or `blocked` (role=note) with the exact failing foregrounds, in AR and EN. Preview and draft stay usable.
- Image panel: states *checking*, *ready*, *unproven*, *insufficient* (with suggestion + apply button), *animated*. Nothing is claimed ready before the evidence arrives.
- `describePublishIssues` maps every stable code to its own sentence (AR/EN); the codes are never confused with each other.
- The gradient seed tint was reduced from 12 % to 4 % so a fresh gradient is provable (12 % failed the muted text). No redesign; same control and layout as P3-A-05.

## 6. Files changed (25 code/test files, +2485 / −461)

**Backend** — `app/Support/Commerce/GlobalBackgroundContrast.php` (new) · `StorefrontPresentationPublishValidator.php` · `SectionDesignContrast.php` (one method made `public`) · `app/Services/Commerce/StorefrontMediaContrastEvidence.php` (`isAnimated`) · `StorefrontPublishedMediaResolver.php` · `CommerceWorkspaceStorefrontPresentationController.php` and `…VersionController.php` (422 instead of 500).

**Web** — `presentation/global-background-contrast.ts` (new, TS twin + `suggestLightOverlay`) · `GlobalBackgroundField.tsx` · `media/use-animated-refs.ts` (new) · `media/use-background-media-bounds.ts` · `announcement-status.ts` · `messages.ts` · `presentation/background-edit.ts`.

**Tests/fixtures** — `tests/Fixtures/presentation/global-background-contrast.json` (12 shared cases) · `GlobalBackgroundPublishPaths.php` (trait) · `StorefrontPresentationGlobalGradientContrastTest` (15; replaces the deleted P3-A-05 gate test) · `StorefrontPresentationGlobalMediaContrastTest` (13) · `StorefrontPresentationPublishApiTest` · web: `global-background-contrast.test.ts`, `GlobalBackgroundField.test.tsx`, `ExperienceBuilder.globalBackground.test.tsx`, `background-edit.test.ts` · e2e `p3-a-06-global-background-readiness.spec.ts` (renamed from the P3-A-05 spec).

No migration, no route, no API-contract change, no accounting impact.

## 7. Tests and CI

**Local**

| Check | Result |
|---|---|
| New/changed PHP (gradient 15, media 13, publish API, schedule API, scheduled job, firewall, evidence) | 68 pass in the final focused run |
| PHP family `Storefront\|GlobalBackground\|Presentation\|Commerce` | 2329 pass, 35 skipped; the one failure it exposed (firewall: validator naming `StorefrontMedia`) was fixed by moving the lookup, not by loosening the test |
| Full web Vitest | 664 files / 7868 tests pass |
| Web production build | pass |
| Playwright visual QA (3 tests: AR desktop, EN desktop, AR 390 px) | pass |
| Web `tsc` | no errors in touched files (existing errors are in unrelated test files on `main`) |
| Mutation checks | removing the fallback union and removing the animated rejection are each caught by a test |

The sandbox has no `bcmath`, so the six `Fuel*` classes fail locally exactly as on earlier PRs; CI installs it.

**GitHub CI** — see the PR checks on `30641d3` (PHP sqlite and pgsql, web build, visual QA). Results are verified directly against the check runs; the final state is recorded in the PR conversation.

## 8. Security and tenant-isolation findings

- No weakening: ownership/readiness gate, publish validator, firewall and RBAC are untouched; the policy only **adds** rejections.
- Cross-tenant media id is rejected (test with a second tenant's asset); evidence and animation lookups cannot see a foreign row.
- Tampered pixel evidence and translucent images are unproven, not trusted.
- A rejection is side-effect-free on all four paths (asserted).
- Found and fixed: invalid authored background ⇒ 500 on save (now 422). Behavioural change is limited to the error status of an already-failing request.
- `main` advanced to `2696f53` after branching; this PR touches storefront presentation files only. GitHub's mergeability must be re-read at review time.

## 9. Coverage and limitations

- The policy is a **conservative sufficient** condition: it can reject a picture that happens to be readable (e.g. text only ever appears over a light region), because where text lands is unknown. This is deliberate; unproven means failed.
- Foreground tokens are fixed in the storefront (`no dark page tokens`); if dark mode for the page is ever introduced the foregrounds must be revisited, and the shared fixture will fail first.
- Evidence for existing library images that predate pixel evidence is absent ⇒ unproven until re-processed.
- Animated media as a global background and video are explicitly not supported.
- The visual QA runs against the demo library, whose pictures are dark, so screenshots show the **blocked** image state and the **ready/blocked** gradient states; the *ready* image state is covered by unit tests and by the PHP tests on real uploaded assets, not by a screenshot.
- The Playwright spec is not wired into a CI workflow; it is local evidence.

## 10. Screenshots

`docs/p3-a-06-visual-qa/` (AR RTL, EN LTR, AR 390 px): `*-1-solid`, `*-2-gradient`, `*-2-gradient-ready`, `*-2-gradient-blocked`, `*-3-image-pending`, `*-4-image-configured` (blocked image with failing foregrounds and "choose a lighter one"), `*-5-after-reset`, `ar-mobile-390-image`. The earlier `docs/p3-a-05-visual-qa/` set is untouched.

## 11. Next step

Owner review of PR #1590. Suggested follow-ups, each its own task: (a) pixel-evidence backfill for library images that predate it, so existing light photos become provable; (b) a merchant-facing "lighten for me" flow if the suggestion proves useful in practice. Do not merge, deploy or start P3-A-07 before approval.

## Restrictions honoured

No merge, no deploy, no production release, no migration, no API-contract change, no unrelated refactor, no weakening of tenant isolation, publish validation or any existing security gate.
