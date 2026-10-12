# CUST-H5-5 — Conflict & Failure Confidence — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-H5 — Undo / Redo, Recovery & Change Confidence |
| **Slice** | **H5-5** — explicit recovery from stale conflicts and failed saves |
| **Branch** | `claude/cust-h5-5` |
| **Authority** | `CUST-H5-EVIDENCE-ARCHITECTURE-EXECUTION-PLAN.md` §3.5 (Save/failure/409 boundary), §5 (conflict recovery contract), §8 (H5-5 scope), §10 (STOP conditions) |
| **Scope** | Web only. **No server, database, API, route or permission change.** The optional «save as new draft» uses two **existing** endpoints (create version, save version), so §5's "only if safely proven" condition is met without a new architecture decision. |

## What was built

### 1. Stale 409 — local work preserved, explicit choices (no merge, no blind retry)

The conflict banner (`data-version-conflict`) now states what is kept and offers three explicit choices:

| Choice | What it does | Touches the original? |
|---|---|---|
| **Review newer version** | Opens the H5-4 saved-history dialog (the winner is the `Current` snapshot) — read-only inspection. | No |
| **Save my work as a new draft** *(only when there are local edits)* | Creates a **separate copy** and saves the merchant's full local document into it. Says plainly it is *a copy, not a merge*. | No — the original (winner) is never written |
| **Reload version** | The pre-existing explicit discard: adopts the server document, clears Undo/Redo. Banner copy now says it discards the edits. | Reads only |

Unchanged and re-asserted: Save stays blocked while a conflict stands (no blind retry); the draft and the in-memory Undo/Redo history survive the 409 (Undo keeps working during the conflict).

### «Save my work as a new draft» — why it is safe (§5 conditions)

| §5 requirement | How it is met |
|---|---|
| Validates the complete document | The save into the copy is the ordinary Version save: the server normalises and validates the **whole** document and enforces the size cap. |
| Creates a tenant-owned new Version | `POST …/versions` with `source_version_id` = the version in conflict — the existing, tenant-scoped create path. |
| Does not overwrite the winner | The winner is only the *source* of the copy; no write ever targets it (asserted in the tests: no second save call carries the original id). |
| Clearly communicates copy, not merge | Banner hint, success notice and name suffix («my edits») all say it. |
| No client-side merge | The merchant's document replaces the copy's content wholesale; nothing is merged. |

Failure semantics, all with the local edits and history untouched:

- Copy creation fails → «Couldn't create the draft… nothing changed».
- Copy created but the save into it fails → the copy's id/revision is remembered (`conflictCopyRef`), the notice says so, and **retry saves into the same copy** — no duplicate copies. A retry that hits a changed/deleted copy discards the memory and creates a fresh one.
- The merchant keeps editing while the request runs → the copy holds the edits as of the click, the newer edits stay in the editor and the conflict stays, with an honest notice.
- The merchant switches version/store meanwhile → only the list is updated; the editor is never yanked.
- Success → the copy is opened, the conflict clears, history resets (a successful Save is the Undo boundary).

### 2. Failed Save — retry confidence

`versionSaveFailed` now says the changes **and Undo history** are still here, nothing was lost, try again. A retry re-sends the **same** Version revision (asserted). History is untouched by a failed Save (§3.5).

### 3. Boundary tests (new, integration)

Stale 409 (draft + history kept, Save blocked, Undo works) · Review opens history without touching the draft · Reload clears history and adopts the server document · save-as-new-draft happy path, create failure, partial failure + same-copy retry · failed Save + same-revision retry · in-flight Save + continued editing (newer edit kept, still dirty, Save still clears Undo) · version switch with discard declined (edit + history kept) vs confirmed (history dropped).

### 4. Dev-harness fix

`lib/mock-data.ts`: the mock's non-GET default swallowed `POST …/versions`, so create (and H5-4's create-from-snapshot) never reached its real mock handler. `POST …/versions` is now let through, exactly like the already-documented `PUT` exception. Dev-harness only; no production code path.

## Contracts honoured

| Contract | How |
|---|---|
| Version-level `revision` is the sole concurrency authority | Untouched. The copy has its own counter; a retry uses the same revision; no revision is ever rewound or invented. |
| Stale 409: no blind retry, no auto-merge | Save stays blocked under a conflict; the only paths forward are explicit merchant clicks; «new draft» is a copy. |
| Save vs Publish separate; Published immutable | No publish involved; the copy is a Draft; Published is never written. |
| Successful Save is the Undo boundary | After a successful save-into-copy the new Version starts with an empty history. |
| Tenant isolation / media / commerce firewall / backward compatibility | No server change; only existing tenant-scoped endpoints are called; no accounting effect. |

## Tests and gates

- New: `ExperienceBuilder.conflictRecovery.test.tsx` — 8 integration tests.
- Broader web: `store-experience-builder` + `commerce-workspace` + `design` + `lib` + `src/app/(commerce)` — **278 files / 3636 tests green**; `tsc --noEmit` clean for touched files.
- Playwright (desktop project): new `cust-h5-5-conflict-recovery.spec.ts` — AR/EN × 390·430·768·1024·1280·1440 (banner choices inside the viewport, no horizontal scroll, primaries reachable) plus save-as-new-draft and Review flows: **14/14**; regression runs of `cust-hv-v1a-toolbar-reachability` + `cust-h5-4-saved-history`: **55/55**.
- Backend: not touched.

## Design Quality Pass

Banner reviewed at AR 390 and EN 1280 (`test-results/cust-h5-5-conflict-recovery/`): the explanation wraps, the three choices wrap as a row of equal-weight outlined buttons (no hidden primary — a conflict has no safe default), the existing warning tone is kept, and the toolbar primaries remain on screen. An initial layout overflow of the button row at 390 was caught by the new e2e and fixed (the container no longer refuses to shrink).

## Limitations (stated)

- «Save as new draft» is not atomic (two requests); the retry-the-same-copy memory covers the realistic failure and the copy is a harmless labelled Draft either way. It is in-memory: a reload mid-way leaves a Draft named «… — my edits» the merchant can delete.
- Review shows the winner via saved history; there is no side-by-side diff (not in the plan).
- Conflict from a rename (no local edits) offers Review and Reload only — «save as new draft» is shown only with local edits.

## STOP conditions

None of §10 was triggered: no contract or API/DB change, no tenant/security uncertainty, no accounting change, no new infrastructure.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-H5 sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
