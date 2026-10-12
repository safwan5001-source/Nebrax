# CUST-H5-4 — Recovery / Restore UX — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-H5 — Undo / Redo, Recovery & Change Confidence |
| **Slice** | **H5-4** — merchant-facing recovery from the durable saved history built in H5-3 |
| **Branch** | `claude/cust-h5-4` |
| **Authority** | `CUST-H5-EVIDENCE-ARCHITECTURE-EXECUTION-PLAN.md` §4 (recovery contract), §6 (boundaries), §8 (H5-4 scope), §10 (STOP conditions) |
| **Scope** | One **additive, optional** request field + one **additive** response field on existing endpoints, and the Customizer UI. No migration, no new route, no new permission, no change to Save / Publish / Schedule contracts or to the Version-level `revision`. |

## Model (frozen by the plan, implemented here)

| Situation | What «Restore» does | Why |
|---|---|---|
| Open Version is a **Draft** | Loads the snapshot's document into the editor as an **ordinary, unsaved edit** (through `updateDraft`). Nothing is written. It is one Undo step; Save later uses the Version's **current** `revision`. | Restore never rewinds the revision and never bypasses the concurrency authority. A merchant can inspect, Undo, or Save. |
| Open Version is **Published** (or otherwise read-only) | No in-place Restore exists. The action is **«Create draft»**: `POST …/versions` with `source_version_id` + the new optional `source_revision_id`, producing a **new Draft** whose first document is the snapshot. Published is untouched. | Published is immutable. |
| Snapshot identical to the current document | Restore is disabled on the `is_current` row; if the editor already equals the snapshot the action reports «no change». | No empty steps. |

## What was built

### Backend (additive)

| Piece | Detail |
|---|---|
| `POST …/presentation/versions` accepts optional `source_revision_id` | Allowed only together with `source_version_id` (validation error otherwise). Resolved **by id + version + storefront under the tenant scope**; anything else ⇒ the existing source-not-found path (404). The new Version starts from the snapshot document normalized under the current schema; forward-schema snapshot ⇒ 409 (same as the H5-3 read). |
| `media_issues` on the snapshot read and on create-from-snapshot | The server re-validates every media reference **at read time** through `StorefrontMediaPublishGate` and reports only `media_missing`, `media_not_ready`, `derivative_not_ready`, `derivative_failed` as `[{path, code, message}]`. The document is returned **unmodified**: media is never resurrected and never silently dropped. Publishing still runs the full gate, so an unavailable image can never go live. |
| Files | `CreateStorefrontPresentationVersionRequest`, `CommerceWorkspaceStorefrontPresentationVersionController::store`, `StorefrontPresentationVersionService` (`resolveSourceConfig`, `mediaIssuesFor`, `showRevisionForCurrentTenant`). |

### Web

| Piece | File |
|---|---|
| Typed client: list / show revisions, create-from-snapshot, fail-closed `media_issues` parsing (a revision detail without a valid `media_issues` list is rejected) | `commerce-workspace/presentation-versions.ts` |
| Saved-history dialog (focus trap, Escape/backdrop close with focus return, loading / empty / error+Retry, `Current` badge, dirty-edits warning; bottom sheet on mobile) | `history/RevisionHistoryDialog.tsx` |
| Read-only preview bar (Restore or Create draft + Exit, merchant-language grouped media issues) | `history/HistoryPreviewBar.tsx` |
| Relative / absolute time labels | `history/revision-time.ts` |
| Integration: the Theme-Preview read-only gating is generalised to `readOnlyPreview`, so a history preview disables Save / Publish / Schedule / Undo / Redo / editing and exits restoring the editor **exactly** as it was. Entry: toolbar button from `lg`, «More» menu item below. History shortcuts stay inert behind the dialog. | `ExperienceBuilder.tsx`, `messages.ts` (AR + EN) |
| Dev-harness stand-ins for the two read endpoints and create-from-snapshot | `lib/mock-data.ts` (dev harness only) |

## Contracts honoured

| Contract | How |
|---|---|
| Version-level `revision` is the sole concurrency authority | Restore (Draft) is a local edit; the next Save carries the **current** revision (test asserts the historical revision is never sent). Create-draft makes a new Version with its own counter. |
| Restore never rewinds revision | `data-selected-version-revision` unchanged after Restore (asserted in unit and e2e). |
| Save vs Publish separate | Restore never saves or publishes (`saveMock` / publish never called in tests). |
| Stale 409: no blind retry, no merge | Untouched. |
| Published immutable | No in-place action is offered for Published; «Create draft» only. |
| Media ownership / tenant isolation | Revision resolved only by id + version + storefront under the tenant scope; foreign ids ⇒ 404 (11 backend tests incl. cross-tenant, cross-version, cross-storefront). Media is re-validated, never altered. |
| Commerce firewall / accounting | No commerce write, no journal entry. The firewall allow-lists needed no change. |
| Backward compatibility | The new request field is optional; the new response field is additive; existing clients ignore it. |

## Tests and gates

| Gate | Result |
|---|---|
| Backend `StorefrontPresentationVersionRevisionRestoreTest` | 11 tests green (source revision resolution, foreign tenant/version/storefront ⇒ 404, validation without source version, schema-forward ⇒ 409, media issues present / absent and document unmodified, Published source untouched, revision counter unchanged). Related backend suites (317) green. |
| Web client | `presentation-version-revisions.test.ts` (paths, parsing, fail-closed, error mapping). |
| Web components | `history-ui.test.tsx` (17) · `revision-time.test.ts`. |
| Web integration | `ExperienceBuilder.revisionHistory.test.tsx` (16): list/empty/error+Retry, read-only Preview + Exit restores exact state, Restore = unsaved + Undo-able + no server write, Save after Restore uses the current revision, media issues surfaced without altering the document, no-op snapshot, dirty warning, Published ⇒ «Create draft» (never Restore), failed create changes nothing, late response after close is dropped, shortcuts inert behind the dialog, More-menu entry. |
| Broader web | `store-experience-builder` + `commerce-workspace` + `src/app/(commerce)`: **194 files / 3031 tests green**. `tsc --noEmit`: no errors in touched files. |
| Playwright (desktop project) | New `cust-h5-4-saved-history.spec.ts` — AR/EN × 390·430·768·1024·1280·1440: entry reachable, dialog inside the viewport, no horizontal scroll, ≥36px touch targets, Preview read-only (Save/Publish disabled), media-issue notice, Restore ⇒ dirty + revision unchanged + Undo available; Escape/Tab focus containment; Published ⇒ «Create draft». Plus the existing `cust-hv-v1a-toolbar-reachability` and `cust-h5-2-undo-redo` specs re-run with the new toolbar button: **71 / 71 green**. |

## Design Quality Pass

Screens reviewed (AR 390 sheet, EN 1280 preview) — evidence in `test-results/cust-h5-4-saved-history/`:

- Mobile: bottom sheet, one primary per row (Restore) with a quiet secondary (Preview), `Current` badge and a disabled Restore on the identical snapshot, RTL order correct.
- Desktop: the preview bar sits under the toolbar with a single primary action; the media notice is amber, grouped, and says what to do («replace them before publishing»); the toolbar stays on one line at 1024 and above (the extra icon replaces nothing).
- Merchant language only — no revision numbers as the primary label, relative time first with the absolute time as detail.

## Limitations (stated)

- Preview renders the snapshot through the editor's existing canvas; per-section diffing is out of scope (the plan's §4 does not require it).
- Restoring a snapshot whose media is unavailable keeps the dangling reference by design; the existing publish gate is what blocks it from going live.
- Conflict & failure UX for stale Saves is H5-5.

## STOP conditions

None of §10 was triggered: no breaking API/DB change (additive optional field only), no tenant-isolation uncertainty (all reads are scoped and tested), no accounting change, no new infrastructure.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-H5 sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
