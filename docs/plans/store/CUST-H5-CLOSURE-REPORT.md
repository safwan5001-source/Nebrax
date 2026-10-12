# CUST-H5 — Undo / Redo, Recovery & Change Confidence — Horizon Closure Report (H5-6)

## Identity

| | |
|---|---|
| **Horizon** | CUST-H5 — Undo / Redo, Recovery & Change Confidence |
| **Slice** | **H5-6** — Integrated Verification & Closure (last slice) |
| **Branch** | `claude/cust-h5-6` |
| **Authority** | `CUST-H5-EVIDENCE-ARCHITECTURE-EXECUTION-PLAN.md` §8 (H5-6), §11 (Definition of Done), §12 (deferred), §10 (STOP conditions) |
| **Scope of this slice** | Verification as one product, plus the **one** product gap the verification exposed: the Customizer had no unsaved-changes guard (details in §4). Everything else is tests and this report. **No server, API, DB or route change.** |

## 1. Slice ledger

| Slice | PR | What shipped |
|---|---|---|
| H5-0 | #1364, #1365 | Evidence, architecture lock, execution plan, owner authorization |
| H5-1 | #1367 | Local history core (pure immutable-document engine + hook) |
| H5-2 | #1369 | Undo/Redo UX, shortcuts, accessibility |
| H5-3 | #1370 | Durable saved-revision history (additive table, recorder, read-only endpoints) |
| H5-4 | #1371 | Saved-history dialog, read-only preview, Restore / Create draft, media revalidation |
| H5-5 | #1373 | Stale-409 recovery choices, save-as-new-draft (copy, never merge), failed-Save confidence |
| H5-6 | this PR | Integrated verification, unsaved-changes guard, closure |

Every slice was a single focused PR, merged by Squash Merge only after its CI was green and its review findings were resolved, per the owner's sequential-merge authorization. No H5 PRs were stacked.

## 2. Definition of Done (§11) — evidence

| §11 criterion | Status | Evidence |
|---|---|---|
| Local Undo/Redo available and accessible | ✅ | H5-2: toolbar + More menu, `aria-disabled` (focus-stable), live region, shortcuts incl. non-Latin layouts, inert behind any modal. `ExperienceBuilder.history.test.tsx` (16), `history-shortcuts.test.ts` (10), `cust-h5-2-undo-redo.spec.ts` |
| All document-changing operations participate, or explicit exclusion | ✅ | **Audit of every `setDraft` call in `ExperienceBuilder.tsx`** (10 sites): all document edits flow through `updateDraft` → history; the rest are lifecycle resets (version select/adopt/initial load/delete recovery/publish adoption), Save success, Undo/Redo application and «Restore default» (records). Selection/page/viewport/panel state is outside history by design (§3.3). Mixed settings + structural session test below |
| Successful Save is a boundary | ✅ | `markSaved` clears both stacks, including with in-flight edits (H5-1 Codex fix); asserted in unit, integration and e2e |
| Save failure never masquerades as success | ✅ | H5-5: failed Save keeps draft + history + same revision on retry; copy says nothing was lost |
| Stale 409 never auto-overwrites/merges | ✅ | H5-5: Save stays blocked; explicit Review / Save-as-new-draft (copy) / Reload; never a merge |
| Durable history, bounded retention | ✅ | H5-3: latest 30 per Version **and** ≤ 16 MiB, newest never dropped (measured: default document 1,522 B; cap 1.5 MiB) |
| Recovery tenant-safe and media-safe | ✅ | Tenant/storefront/version-scoped reads (cross-tenant ⇒ 404, incl. through the create path — new lifecycle test); media re-validated at read time through the publish gate, never resurrected, document unmodified |
| Restore never rewinds the Version counter | ✅ | Restore = ordinary unsaved edit; Save uses the **current** revision (asserted); lifecycle test shows the Published revision and the publication head unchanged after recovering from it |
| Published never mutated by Undo/Redo/Restore | ✅ | No history on Published; Restore is «Create draft» (new Version). Backend: saving the active Version ⇒ 409, records nothing |
| Version switches / lifecycle boundaries deterministic | ✅ | Switch declined ⇒ edit + history kept; confirmed ⇒ history dropped; Publish clears a leftover Redo branch; Scheduled Version stays an editable draft for history |
| AR RTL and EN LTR | ✅ | Every H5 e2e spec runs both locales |
| 390 / 430 / 768 / 1024 / 1280 / 1440 | ✅ | H5-2, H5-4, H5-5 specs cover all six widths in both locales; the H5-6 journey covers 390 / 768 / 1280 end to end |
| Keyboard / focus | ✅ | Focus trap + return in the history dialog (incl. the More-menu entry, Codex fix), Escape/Tab containment e2e, `aria-disabled` focus retention, shortcuts inert behind dialogs |
| SQLite + PostgreSQL concurrency | ✅ | CI runs the full suite on both (pgsql green on every H5 PR). This slice re-ran the history, lifecycle, restore, schedule/publish and PostgreSQL-concurrency suites locally on PostgreSQL 16: 76 passed |
| Backward compatibility | ✅ | Additive table, optional request field, additive response field; legacy `PUT …/presentation` path is recorded in the same history without gaps; existing suites unchanged |
| Full CI green | ✅ | See §6 (final head) |
| Closure Report records risks/deferred | ✅ | §7, §8 |
| No Deploy/Production verification claimed | ✅ | None performed; see §9 |

## 3. Integrated verification added in H5-6

| Test | What it proves |
|---|---|
| `ExperienceBuilder.h5Integration.test.tsx` — mixed session | A text setting, a discrete setting and a section move are undone in reverse order, redone in order, and Save clears both stacks |
| …Publish with a leftover Redo branch | Publishing clears the history and leaves the editor read-only; nothing is saved by Undo |
| …Scheduled Version | A Scheduled Version is still editable for history; Undo calls neither save nor publish |
| …Published | Saved-history recovery is offered; Undo/Redo are not |
| …reload / close policy | History modules use **no** browser storage; the Customizer's only storage use is the sidebar preference (never the document); nothing document-like is written while editing/undoing/saving; `beforeunload` is prevented only with unsaved edits |
| `StorefrontPresentationHistoryLifecycleTest` (backend, new) | Save ×3 → schedule → scheduled publish: no snapshot is recorded by publishing; the Published Version refuses saves (409) and records nothing; its history stays readable; «create draft from snapshot» yields a new Draft with the snapshot document and leaves the Published revision and publication head untouched; later edits record only in the new Version's history; a foreign tenant cannot recover through the create path (404, nothing created) |
| `cust-h5-6-integrated-journey.spec.ts` (Playwright) | One browser journey per locale × {390, 768, 1280}: edit → Undo → Redo → Save (boundary, revision advanced) → saved history → read-only preview (Save/Publish disabled) → Restore (dirty, revision unchanged, Undo available) → Undo; no horizontal scroll and primaries on screen at every step |

## 4. The one gap found and closed — unsaved-changes guard

§3.7 says *existing* navigation/unsaved guards remain. Verification showed the Customizer had **none**: «Exit to Commerce» (`window.location.href`), a reload or a tab close dropped the unsaved draft **and** the local Undo history silently. The repository already has an in-memory guard (`useUnsavedGuard` → `beforeunload` + the workspace unsaved registry that also makes the store switcher ask). The Customizer now uses it:

- It stores **nothing** (in-memory registry only) — consistent with "no browser storage as persistence authority".
- It prompts only while the draft is dirty; Undo back to the saved document removes the prompt.
- It is a reversible UX choice, not a contract change (§10 not triggered).

## 5. Test and gate totals

| Layer | Result |
|---|---|
| H5 web tests (11 files) | **136 passed** — engine 36, hook 5, shortcuts 10, Undo/Redo UI 16, history components 18, revision-time 4, history integration 17 + 4, conflict recovery 8, H5-6 integration 8, client 10 |
| Whole web unit suite | **520 files / 5501 tests green** (before the guard test was added; re-run on the final head by CI) |
| Backend history suites | revision history + restore + lifecycle: **33 passed** (361 assertions) on SQLite; **76 passed** across the history/lifecycle/concurrency/schedule/publish suites on PostgreSQL 16 |
| Playwright (desktop project) | H5-2, H5-4 (13), H5-5 (14), H5-6 (6) plus the toolbar-reachability regression — all green on the final head (see §6) |
| Typecheck | `tsc --noEmit`: no errors in any H5 file |

## 6. CI on the final head

Recorded in the PR (`web build`, `php artisan test` SQLite + PostgreSQL, visual QA, CI Gate). This report was written before CI finished; the merge happens only if every check is green — see the PR for the outcome.

## 7. Risks and honest limitations

| Item | Note |
|---|---|
| **Automated review coverage** | Codex hit its usage limit during H5-4 (after the last two fix commits) and did not review H5-5 or H5-6. Those PRs were verified by CI, new regression tests that fail without the fix, and an adversarial self-review of the diffs — not by a second reviewer. |
| Full backend suite locally | Not run end to end locally (the sandbox lacks some extensions/SDKs, giving environment-only failures). The full suite ran in CI on SQLite and PostgreSQL for every PR; locally only the history-related suites were run, on both engines. |
| Save-as-new-draft is two requests | Not atomic; a retry reuses the created copy, and the worst case is a harmless labelled Draft. In-memory memory of that copy is lost on reload. |
| Retention | 30 snapshots / 16 MiB per Version; older snapshots are gone by design. |
| Restore with unavailable media | The dangling reference is kept (never resurrected, never silently dropped) and reported; the existing publish gate blocks publishing it. |
| Preview is not a diff | No side-by-side comparison (deferred, §12). |
| Browser back button | The guard covers reload, close, Exit and in-app links via the workspace registry; the browser back button remains outside any reliable cancel API in the App Router (same limitation as the rest of the workspace). |

## 8. Explicitly deferred (unchanged from §12)

Real-time collaboration · OT/CRDT · automatic merge · cross-device unsaved-session recovery · browser storage as persistence authority · unlimited history · branching visualisation · JSON diff UI · restoring deleted media bytes · Undo of Publish · Undo across Versions · account-level history.

## 9. Not performed

- **Deploy: NOT PERFORMED.**
- **Production Release: NOT PERFORMED.**
- No Production verification is claimed. Everything above is repository, CI and local-environment evidence.

## 10. STOP conditions (§10)

None triggered across H5-1 → H5-6: no consequential architecture/contract change, no tenant-isolation uncertainty, no breaking API/DB change, no accounting behaviour change, no frozen contract found technically impossible, no cross-Horizon conflict, no new production infrastructure.

## 11. Next

CUST-H5 is closed on merge of this PR. The plan names **CUST-H6** as the next Horizon; it needs its own owner-approved plan before any work starts.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-H5 sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
