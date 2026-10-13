# CUST-H5-1 — Local History Core — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-H5 — Undo / Redo, Recovery & Change Confidence |
| **Slice** | **H5-1** — Local History Core (first of H5-1 → H5-6) |
| **Branch** | `claude/cust-h5-1` |
| **Authority** | `CUST-H5-EVIDENCE-ARCHITECTURE-EXECUTION-PLAN.md` §3 (frozen UX contract), §8 (H5-1 scope), §9 (execution model), §10 (STOP conditions) |
| **Scope** | Web only. A pure history engine plus a thin React hook, with tests. **No server, database, API, migration or public-storefront change. Nothing is wired into the editor yet** (H5-2 owns the toolbar, shortcuts and the `ExperienceBuilder` integration). |

## What was built

| File | Role |
|---|---|
| `store-experience-builder/history/document-history.ts` | Pure engine over an immutable document `T`: `createHistory`, `resetHistory`, `recordEdit`, `undo`, `redo`, `markSaved`, `canUndo`, `canRedo`. No React, no clock, no network, no browser storage. |
| `store-experience-builder/history/use-document-history.ts` | Thin hook. State lives in a ref so `undo(); undo()` inside one handler sees each other's effect. Re-renders only when `canUndo`/`canRedo` actually change. The editor stays the owner of `draft`; the hook only tracks history and returns the document to apply. |
| `__tests__/document-history.test.ts` | 36 tests: core, grouping, scope and boundaries, real presentation documents, seeded random-sequence invariants against a reference model. |
| `__tests__/use-document-history.test.tsx` | 5 tests: hook wiring, synchronous multi-undo, injected clock, stale-Version callbacks, Save/end boundaries. |

## Frozen contracts → how H5-1 honours them

| Contract (plan §3) | Mechanism | Proof |
|---|---|---|
| History is keyed to the active Version id | Every state carries `scopeKey`. `recordEdit`/`undo`/`redo`/`markSaved` called with another Version's key return the **same state reference** and do nothing. A `null` scope (no open Version) can never undo/redo. | "operations for another Version are ignored", "a null scope…", hook test "a callback bound to a previous Version cannot touch the new session" |
| Version switch / discard / lifecycle → Published clears history | `resetHistory(scopeKey, doc)` replaces the whole session, scope included; `end()` in the hook disables it. | "resetHistory replaces scope and clears both stacks" |
| **Successful Save is a hard boundary** | `markSaved` clears both stacks on every successful Save, including when edits were made while the request was in flight (the newer local document stays as present). Otherwise the **server-normalised** document becomes the present. | "successful Save is a hard boundary", "Save adopts the server-normalised document" |
| Failed Save does not clear history | The engine exposes no failure path at all, so nothing can clear the stacks on failure. | "a failed Save has no engine call" |
| Stale 409: no auto-retry, no merge | The engine never talks to the server and never replays operations. History stays in memory untouched. | By construction (no I/O). H5-5 owns the 409 UX. |
| New edit after Undo clears Redo | `recordEdit` sets `future = []`, including on the coalesced path. | "a new edit after undo drops the redo branch", "a coalesced edit still drops the redo branch" |
| Undo follows merchant intent, not keystrokes | Optional `group` key + sliding window (default 1000 ms, injected clock): same key inside the window ⇒ one step. Different key, ungrouped edit, a pause, an Undo/Redo, or a backwards clock ⇒ a new step. A burst that returns to where it began leaves no step behind. | Eight grouping tests |
| History is bounded | `maxEntries` (default **100**, floor 1); oldest drops first. | "history is bounded", "honours a custom maxEntries" |
| No browser-storage authority | No `localStorage`/`sessionStorage`/IndexedDB anywhere in the module. A reload discards the session, as §3.7 requires. | Review of the module (no storage API imported) |
| Published is never touched | The engine has no concept of Published; H5-2 must call `end()`/`resetHistory` when the open Version becomes Published. | Contract noted for H5-2 |
| Version-level `revision` is the sole concurrency authority | The engine has no revision, token or merge concept and adds no field to the document. | By construction |

## AWJ decisions recorded here

| Question | Decision | Why |
|---|---|---|
| Save while the merchant kept typing | `markSaved(…, editedSincePersist = true)` keeps the newer local document as the present (the editor already preserves edits made during an in-flight Save) but **clears both stacks**, exactly like any successful Save (§3.5). Undo cannot cross the boundary, not even back to the saved document. | An earlier draft of this slice kept the saved document as one undo entry; review (Codex, P2) correctly flagged that as a breach of the hard boundary. Corrected before merge; the hook and engine no longer accept an options argument for `markSaved`. |
| Snapshots by reference | Entries are references, not deep clones. | `updateDraft` already yields a fresh normalised object for every edit, and documents are plain JSON (CUST-HV moved media to id references). Deep-cloning 100 snapshots per edit would add cost for no safety gain. A test pins that mutating a *copy* of the present document cannot corrupt an earlier snapshot. |
| Stale-Version callbacks | Ignored silently (same reference returned) rather than throwing. | The editor already guards delayed responses by Version token; an extra throw would turn a harmless race into a crash. |
| Group window | 1000 ms sliding. | A short phrase typed continuously is one step; a deliberate pause starts another. Tunable via `coalesceWindowMs`; H5-2 chooses group keys. |

## Integration contract for H5-2 (not implemented here)

- Single choke point already exists: `ExperienceBuilder.updateDraft(next)` (all document edits). H5-2 calls `history.record(versionId, normalized, group)` there and applies `history.undo()`/`redo()` results through a path that does **not** re-record.
- Call `begin(versionId, doc)` on Version open/switch/discard/restore-to-default, `markSaved(…)` only inside the `result.ok` branch of `handleSave` (using the existing `editedSincePersist`), and `end()` when the open Version is Published or none is selected.
- Selection, page, preview product/category, viewport and panel state stay outside the history (plan §3.3).

## Tests and gates

- Focused: 41 new tests green (36 engine + 5 hook).
- Broader: `store-experience-builder` + `commerce-workspace` suites (see PR for the final CI run).
- Typecheck: no errors in the new files (the repository has unrelated pre-existing `tsc` errors in other test files; none touched).
- No PHP/backend change, so backend suites are unaffected.

## Design Quality Pass

Not applicable — no visual or interaction surface in this slice. H5-2 carries the Design Quality Pass.

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, Version-level concurrency, media ownership, commerce firewall, backward compatibility: **untouched** (additive, unreferenced module). No accounting behaviour. No STOP condition from §10 was triggered.

## Limitations (stated)

- The module is intentionally dormant until H5-2 integrates it; no user-visible behaviour changes in this slice.
- Memory bound is by step count (100 whole-document references), not bytes. H5-0's size evidence gate applies to the *durable* history in H5-3; local history shares structure where the editor does.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-H5 sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
