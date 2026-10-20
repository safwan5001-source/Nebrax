# P3-A-05 — Advanced Storefront Background Editor — Implementation Report

**Verdict: READY FOR OWNER REVIEW** — PR open, not merged, not deployed.

| | |
|---|---|
| Branch | `p3-a-05-advanced-background-editor` |
| PR | https://github.com/safwan5001-source/Nebrax/pull/1587 |
| Base when branched | `481e4f20779eca908d969dc5b5b2ec6e8a3a2d92` (PR #1570 merge) |
| Base now (`main`) | `be7a6c61b78b7f4c7d3f3b67f11c815c7547ce87` — `main` advanced after branching; PR reports `mergeable: clean`, no sync commit needed |
| CI-validated Head | `03852f223ea468865ac263c2470fe58381886e9c` |

> The commit that adds this report is documentation-only and is not the CI-validated Head. All results below belong to `03852f2`.

## 1. Implementation summary

One control, «خلفية المتجر», in the existing Appearance panel, over the existing `StorefrontBackground` contract. It replaces the old single colour field, which wrote only the legacy `backgroundColor` and therefore lost to any `background` object.

**Core rule** (`presentation/background-edit.ts`): a *solid* background is the legacy `backgroundColor` with **no** `background` object; gradient and image are *added* on top of it. This is deliberate: the server replaces the document as a whole (absent key ⇒ no advanced background), the storefront paints `background` over `backgroundColor`, and the server contrast gates read `backgroundColor` only.

| Type | Behaviour |
|---|---|
| لون ثابت / Solid | Existing picker + HEX box; commits only a valid HEX (draft + error while typing). Switching from gradient/image drops the object and starts from the previous colour. |
| تدرج لوني / Gradient | Two colour controls (hex or palette role), the 8 approved logical directions, in-panel preview painted by the same resolver as the canvas/storefront. New gradient seeds visibly (page colour → 12 % tint of the brand colour). |
| صورة خلفية / Image | Existing media picker for desktop image + optional phone image; per-image 3×3 focal grid; overlay colour + approved strengths (5–90); clear/replace each image. Still-only; no animation controls; no crop/rotate (the global layer paints only focal). |
| Restore default | Removes any advanced object **and** returns the default colour. The panel states how this differs from switching type (type switch keeps your colour and is undoable). |

Preserved: legacy documents open as Solid and are not edited by opening; Undo/Redo, dirty tracking, Save and presentation version (the control feeds the same `onChange`).

## 2. Files

**Added**
- `web/src/modules/store-experience-builder/GlobalBackgroundField.tsx` — the control
- `web/src/modules/store-experience-builder/presentation/background-edit.ts` — pure edit rules
- `web/src/modules/store-experience-builder/__tests__/{background-edit.test.ts, GlobalBackgroundField.test.tsx, ExperienceBuilder.globalBackground.test.tsx}`
- `web/e2e/p3-a-05-global-background-editor.spec.ts` — visual QA
- `docs/p3-a-05-visual-qa/*.png` — 7 screenshots

**Changed**
- `ControlPanels.tsx` — mounts the control in `ThemePanel` (passes whole-config `onChange` as `replace`); removes the old field and two orphaned imports
- `messages.ts` — 12 AR + 12 EN keys
- `announcement-status.ts` — `describePublishIssues` explains `global_media_background_not_ready`
- `design/DesignInspector.tsx` — `DIRECTION_LABEL` exported (one word) for reuse
- `tests/Feature/StorefrontPresentationPublishApiTest.php` — 2 new tests

## 3. UI behaviour and visual evidence

Real browser (Playwright, demo-mode builder), AR and EN desktop plus AR 390 px mobile. Screenshots in `docs/p3-a-05-visual-qa/`:

| File | Shows |
|---|---|
| `ar-1-solid.png` | Solid (legacy default): only solid fields |
| `ar-2-gradient.png`, `ar-2-gradient-page.png` | Gradient controls + canvas preview in RTL |
| `ar-3-image-pending.png` | Image tab before a pick: hint + draft-only note |
| `ar-4-image-configured.png`, `en-4-image-configured.png` | Desktop + phone image, focal, overlay, draft-only note, Restore default |
| `ar-mobile-390-image.png` | Mobile sheet, no horizontal overflow |

Defects found by looking at the screenshots and fixed before the PR:
1. The focal grid mirrored in RTL (the «right» cell sat on the left while the picture moved right). Focal is physical, so the grid is now LTR; asserted by unit test and by e2e bounding boxes.
2. The first gradient seed was almost identical to the page colour, so choosing Gradient looked like nothing happened.
3. A new attribute name collided with the `data-global-background-image` attribute of the P3-A-04 layer; renamed to `data-global-bg-panel`.

## 4. Compatibility and publish safety

| Invariant | Evidence |
|---|---|
| `global_media_background_not_ready` unchanged | No PHP app code touched; PHP test confirms an editor-shaped image document (desktop + phone + focal + overlay) is saved as draft and publish returns the code |
| Normal publishing for safe backgrounds | PHP test: gradient (hex + role, logical direction) publishes and reaches the snapshot unchanged; removing `background` (Solid / Restore default) unblocks publishing |
| No false publish-ready state | Draft-only note shown in Image mode from the first click; test asserts no «ready/publishable» wording; solid/gradient never show it |
| Rejection is understandable | `describePublishIssues` maps the server code to an actionable sentence (AR + EN) instead of the generic failure |
| `backgroundColor` legacy behaviour | Unchanged and still the fallback/contrast colour; legacy documents untouched until an explicit edit |
| `SectionBackground`, DB, APIs, media endpoints | No change; section inspector regression-tested |
| No persisted URLs / CSS / resolved media | Round-trip test (save → normalise → reload) asserts no `http`, `url(`, gradient CSS or signed-URL fields; previews use the existing runtime resolution |
| Tenant / media isolation | Unchanged (uses the existing picker and `MediaRef`); no new endpoint |

## 5. Tests, build and CI

**Local**

| Check | Result |
|---|---|
| New web tests (40) | pass; a deliberate mutation (solid no longer drops `background`) fails 8 of them |
| Full web Vitest | 661 files / 7807 tests pass |
| Web production build | pass |
| Design-drift ratchet | pass (semantic tokens only) |
| `StorefrontPresentationPublishApiTest` | 10/10 pass |
| Visual QA spec | 3/3 pass |
| Full `php artisan test` | 7930 pass, 146 skipped, **26 fail** — all in six `Fuel*` classes with `Call to undefined function bcmul`: the `bcmath` extension is not installed in this sandbox (the session hook warns of this). Unrelated to this PR; CI installs it. |

**GitHub CI on `03852f2`** — all 7 check runs `success`: CI Gate, php artisan test (sqlite), php artisan test (pgsql), web build (two runs), merchant preview visual QA, published footer visual QA. The storefront CI job did not run (no storefront file changed). PR `mergeable_state: clean`.

## 6. Remaining risks

- **Gradient/image contrast is not judged.** The server gates read `backgroundColor`; a merchant can author a dark gradient under dark text and still publish a gradient. That gap already existed at render level (P3-A-04) and is the stated scope of P3-A-06, but this editor makes it authorable. Recommend P3-A-06 covers gradients as well as images.
- **Switching away from Image discards the image configuration** (recoverable only via Undo within the session). No confirmation dialog was added.
- **Solid is hex-only.** An authored solid object that uses a palette role becomes a hex on the first explicit edit.
- **«Image» tab is UI state until a picture is picked**; it is lost if the panel remounts. Clearing the main image also clears the phone image and overlay.
- **The new Playwright spec is not wired into a CI workflow** (`store-brand-qa.yml` triggers on its own spec path only); it is local evidence, re-runnable with the commands in its header.
- **No Codex review ran** — it failed with the usage-limit message on this PR as on #1570. No human review yet.
- `main` moved to `be7a6c6` after branching; GitHub reports no conflict, but the merge result was not re-run locally.

## 7. Recommended next step

Owner review of PR #1587. Then P3-A-06 (contrast approval and removal of the temporary media gate), with gradient contrast in scope. Do not start P3-A-06 or merge before approval.

## Restrictions honoured

No merge, no deploy or release, no schema/API change, `global_media_background_not_ready` and `SectionBackground` untouched.
