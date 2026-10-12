# CUST-H5-2 — Undo / Redo UX & Accessibility — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-H5 — Undo / Redo, Recovery & Change Confidence |
| **Slice** | **H5-2** — wires the H5-1 history core into the Customizer (toolbar, More menu, keyboard, accessibility) |
| **Branch** | `claude/cust-h5-2` |
| **Authority** | `CUST-H5-EVIDENCE-ARCHITECTURE-EXECUTION-PLAN.md` §3 (frozen UX contract), §8 (H5-2 scope), §10 (STOP conditions) |
| **Scope** | Web only. **No server, DB, API, migration, public-storefront or accounting change.** No new dependency. |

## What was built

| Piece | Where |
|---|---|
| Intent grouping: one changed text/number leaf ⇒ shared group key | `history/change-intent.ts` |
| Shortcut resolution, native-field exclusion, platform hints | `history/shortcuts.ts` |
| Editor wiring (record, Undo/Redo, Save boundary, scope lifecycle, keyboard, live region) | `ExperienceBuilder.tsx` |
| AR / EN strings (`undo`, `redo`, reasons, announcements) | `messages.ts` |
| Unit + integration tests | `__tests__/change-intent.test.ts`, `history-shortcuts.test.ts`, `ExperienceBuilder.history.test.tsx` |
| Real-browser spec (16 cases) | `e2e/cust-h5-2-undo-redo.spec.ts` |

## Frozen contracts → how H5-2 honours them

| Contract (plan §3) | Mechanism | Proof |
|---|---|---|
| Undo/Redo controls on the toolbar; mobile reachable without desktop chrome | Inline icon buttons from `md` (768); below `md` the **same two actions, same eligibility and wording** are in the «More» menu — Exit / Save / Publish are unchanged. | e2e at 390/430 (More) and 768–1440 (inline), AR + EN |
| Shortcuts: Win/Linux `Ctrl+Z`, `Ctrl+Y`, `Ctrl+Shift+Z`; macOS `Cmd+Z`, `Cmd+Shift+Z` | `resolveHistoryShortcut` (pure). Works on an Arabic layout through the physical key (`code`), and follows the letter on Latin layouts that moved Z (Dvorak). | `history-shortcuts.test.ts`; e2e keyboard case |
| Never steal native text undo | Ignored inside text-like inputs, textarea, contenteditable, `textbox`/`combobox`/`searchbox`/`spinbutton` roles. Checkbox/range/radio/colour/buttons are **not** exclusions (no text history there). Also ignored whenever **any** dialog is open in the document (`[role=dialog]` / `[aria-modal=true]`, excluding `aria-hidden`), plus the Publish/Schedule/Cancel-schedule state and mobile sheets: overlays such as the section library and bottom sheets leave focus on their trigger behind the layer, so checking the event target alone is not enough (three Codex review rounds; one generic guard replaces enumerating modals, each path has a regression test that fails without the guard). | unit + RTL integration (`defaultPrevented === false` inside a field) + e2e |
| History scoped to the active Version; cleared on Version switch / storefront switch / Published / discard / reload | `historyScope` = open Version id (Published or none ⇒ no scope ⇒ no history); effect re-`begin`s on scope change; adoption of a created/reloaded Version resets explicitly (a same-id reload does not change the scope). Reload/browser loss discards the session (no browser storage). | `Version switch starts a fresh session`, `Published is read-only` |
| **Successful Save is a hard boundary** | `history.markSaved(...)` in the `result.ok` branch only (after the stale-Version guard) — clears both stacks, including when the merchant kept editing during the PUT (the newer draft is kept, history empty). | `a successful Save is a hard boundary` (RTL + e2e) |
| Failed Save keeps history; stale 409 keeps history, no retry, no merge | No history call on those paths. The 409 path was not touched. | `a failed Save keeps…`, `a stale 409…` (Save called once, Show called once) |
| Undo is merchant intent, not keystrokes | A burst editing the **same single text/number field** within 1 s is one step (`intentGroupKey`). Structural ops (move/add/delete/duplicate), booleans, multi-field edits (presets) and any shape change never group — two quick «Move down» clicks stay two steps. | `change-intent.test.ts`; typing a phrase = one Undo (integration) |
| Pure editor context is not in history | Selection, page, preview product/category, viewport, panels are untouched. After a step, a selected section that no longer exists is deselected. | by construction + integration |
| Undo/Redo never touches Published, network or revision | `applyHistoryStep` only sets the local draft/lifecycle; no call to any API. | `Undo never calls the network` |
| Version-level `revision` remains the sole concurrency authority | Nothing in the document, the Save payload or the revision handling changed. | existing persistence/versions suites unchanged and green |

## Accessibility

- Icon buttons carry `aria-label` (AR «تراجع عن التعديل» / «إعادة التعديل», EN Undo / Redo), a `title` with the platform's shortcut hint (`Ctrl+Z` / `⌘Z`, `Ctrl+Y` / `⇧⌘Z`), and `aria-keyshortcuts`.
- **`aria-disabled`, not `disabled`:** after the last Undo the button keeps keyboard focus (e2e + visible focus ring). When unavailable the title says *why* («No unsaved changes to undo» / «Nothing to redo») — honest about the Save boundary.
- Platform (Mac vs other) is resolved **after mount**, so server HTML and the first client render agree (no hydration mismatch in the `title` / `aria-keyshortcuts`; Codex review finding).
- A polite `aria-live` region (no `role="status"`, so it does not collide with the notice banner) announces «Last change undone.» / «Change redone.»; a trailing zero-width toggle re-announces repeated identical results.
- Group has an accessible name; More-menu twins use the same labels and `disabled` semantics as the other menu items.
- Arabic label deliberately **not** the bare «تراجع»: that word is already the schedule dialog's «keep it / back out» button and would be an ambiguous accessible name.

## Design Quality Pass

- **Layout:** two 36 px quiet icon buttons, no border at rest, immediately before Save — secondary visual weight (Save/Publish remain the primaries). No new colour; reuses the toolbar's tokens, hover and `ring-primary/40` focus ring.
- **RTL/LTR:** arrows mirror by the **builder's `locale`**, not by `<html dir>` (Tailwind's `rtl:` matches any RTL ancestor even when the nearest is LTR — caught in the real-browser screenshot: EN showed mirrored arrows under the dev page's RTL `<html>`). Undo sits on the start side in both directions; asserted by bounding boxes.
- **Real browser, Chromium:** widths **390 · 430 · 768 · 1024 · 1280 · 1440**, **AR RTL and EN LTR** — Exit / Save / Publish inside the viewport, non-overlapping, toolbar never scrolls horizontally, Undo/Redo ≥ 36 px and inside the viewport inline (≥ 768) or reachable from More inside the viewport (< 768).
- **Regression guard:** the existing `cust-hv-v1a-toolbar-reachability` spec (41 cases: clean / dirty / conflict × 6 widths × AR/EN + More-menu cases) still passes with the new controls in the bar — 57/57 across both specs.
- Screenshot evidence is produced per run under `web/test-results/cust-h5-2-undo-redo/`.

## Tests and gates

- New unit/integration: 21 (intent + shortcuts) + 11 (editor) — green. Existing `ExperienceBuilder.*` suites: 16 files / 236 tests green; broader `store-experience-builder`, `commerce-workspace`, `(commerce)`, `components/ui` suites green after fixing two accessible-name collisions this slice introduced (live-region `role="status"`; the bare Arabic «تراجع»).
- e2e: 16 H5-2 cases + 41 V1A cases pass locally in Chromium.
- Typecheck: no errors in files touched by this slice.
- No PHP change.

## AWJ decisions recorded here

| Question | Decision | Why |
|---|---|---|
| Inline from which width? | `md` (768) and up; More menu below. | Keeps the 390/430 toolbar contract (V1A) untouched; 768 verified to fit. |
| `Restore default` | An ordinary edit — recorded and undoable. | It is a draft edit behind a confirm, not a boundary. |
| Group window | 1 s sliding, single text/number leaf only. | Conservative: never merge structural or multi-field intents. |
| Theme Preview mode | Undo/Redo unavailable while previewing. | The editor is read-only/inert in that mode. |
| Local-only editing (no storefront) | One fixed scope; history works. | Preserves the legacy local path. |

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, Version-level concurrency, media ownership, commerce firewall, backward compatibility: **untouched**. No accounting behaviour. No §10 STOP condition triggered.

## Limitations (stated)

- Undo/Redo is the unsaved-session history only; durable recovery after Save/reload is H5-3/H5-4.
- Shortcuts are not delivered from inside an iframe; the Canvas is in-DOM so this does not apply today.
- Mobile reaches Undo/Redo via More (two taps), a deliberate trade for keeping the Canvas-first bar intact.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-H5 sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
