# Storefront Appearance Editor — Input Audit & Root-Cause Fix

Base: `main` @ `704a7efe1f5aabdd4ba3cb8b92394510446261e7` · Branch: `fix/storefront-editor-input-typing` · Scope: `web/src/modules/store-experience-builder` only.
No schema, API contract, financial logic or tenant boundary was touched. Not merged, not deployed.

## 1. Root causes and evidence

**One shared cause, not two.** `ExperienceBuilder.updateDraft` runs `normalizePresentationConfig(next)` on *every* change and stores the result as the draft.
A field whose `value` is bound straight to the draft therefore gets the **normalised** text back after each keystroke:

| Symptom | Normaliser rule applied per keystroke | Result while typing |
|---|---|---|
| Announcement message: Space "does nothing", paste works | `normalizeAnnouncementText`: control-chars → space, **PHP-trim**, cap | `Free ` → `Free` before the next letter arrives → `Freeshippingtoday`. A pasted string already contains inner spaces, so it survives. |
| Social URL: typing does nothing, paste works | `sanitizeExternalUrl`: only a *complete* `https://…` is kept, else `""` | `h` → `""` → the field is wiped after every key. A pasted full URL passes validation in one step. |

Not a keyboard-event problem. Ruled out by reading and by test: the only window-level `keydown` handlers are Undo/Redo (`resolveHistoryShortcut`, which already skips native editing targets via `isNativeEditingTarget`) and Escape for the tablet drawer; no `beforeinput`/`keyup` handlers; no unstable `key=` remounting the inputs; no IME-specific code.
Existing tests missed it because every panel test passed `onChange={vi.fn()}`, which never feeds the normalised value back. The new test harness reproduces the real loop (`onChange → normalizePresentationConfig → re-render`).

**Reproduction (before the fix):** 9 of 12 initial typing tests failed with exactly the reported symptoms (`'Freeshippingtoday'`, `''` instead of the URL, announcement link keeping only `/sale`).

## 2. Affected fields

Found by reading every normaliser rule, then confirmed empirically by typing `a b c` into every text control of each section type through the real normalise loop (scratch probe, deleted afterwards).

| Field | Defect | Status |
|---|---|---|
| Announcement → message text | trailing/inner space lost | fixed |
| Announcement → link | partial URL / path dropped | fixed |
| Social links → URL (each row) | partial URL dropped (reported) | fixed |
| Verification → source URL | partial URL dropped (**not reported**) | fixed |
| Banner → title, subtitle | space between words lost | fixed |
| Banner → image URL | partial URL dropped | fixed |
| Benefits → title, body | space between words lost | fixed |
| Social links → visibility toggle | **different bug**: non-target rows were replaced by the toggled row (`: item` instead of `: row`) — data loss | fixed |

Inspected and **not** affected: section name; Hero headline / supporting line / button text (only a *leading* space is dropped — that is the stored-trim contract, not a defect); all CTA link fields, app-store URLs, banner image alt (already `DeferredCommitField`); heading/paragraph blocks, shelf titles (already `BufferedText`); footer tagline/copyright, contact fields, WhatsApp, SBC fields (kept lossless in `updateDraft`); colour hex fields (own local state); navigation external-link form (local state); version-name input (local state). Date/time pickers are not free-text.

## 3. Fix (smallest shared change)

`BufferedText` (already the editor's pattern for headings/paragraphs) gained optional `normalize`, `className`, `dir`, `inputMode`, `maxLength`. The field keeps what the merchant typed and adopts the draft's value **only when it differs from `normalize(typed)`** — so external changes (Undo/Redo, restored version, another item selected) still win, but the draft's own trimming/validation no longer rewrites the field. The draft still stores the normalised value, so preview, Save, validation and limits are unchanged.

Files: `BufferedText.tsx`, `AnnouncementsPanel.tsx`, `ControlPanels.tsx`, `presentation/announcements.ts` (extracted `normalizeAnnouncementText` so the field and the normaliser share one rule), new `__tests__/ControlPanels.typing.test.tsx`.
Caps use `limit` (code points, as the contract counts) so a field never shows text Save would drop.

## 4. Tests

- New `ControlPanels.typing.test.tsx`: 17 tests — EN/AR spaces, trailing-space stored-trim, Backspace/mid-text edit, announcement link (https + internal path), Instagram & Snapchat URLs key by key, paste/clear/Backspace, unsafe `javascript:` stays unstored, verification URL, 120-point cap, banner title/subtitle/image URL, benefits title/body, Undo-style external sync, toggle isolation. Fail before / pass after (toggle test confirmed failing first).
- `store-experience-builder` suite: 132 files / 2397 tests pass. Full web suite: 524 files / 5581 tests pass (before adding the toggle test; editor suite re-run after).
- `tsc --noEmit`: error list identical to clean `main` (pre-existing errors in unrelated test files, e.g. `SliderFields.test.tsx`); none in touched files.
- `npm run build` (Next.js 15.5): succeeds. ESLint: repo has no `eslint.config` for v10, so lint could not run.

## 5. CI status
Not yet observed at the time of writing; see the PR checks.

## 6. Risks / unverified

- **Not verified in a real browser**: jsdom + `user-event` simulates key events, not a physical keyboard. Manually unverified: **IME composition** (Arabic/CJK IMEs), RTL caret behaviour, and the live-preview repaint. Logic-wise IME is safer than before (the field is no longer rewritten mid-composition), but this should be smoke-tested.
- Undo/Redo grouping (`continuousInput`) and shortcut isolation are covered by the existing 2397 editor tests (all pass); not re-tested manually.
- `normalize` helpers in `ControlPanels.tsx` mirror `normalizeBanner/Benefits` (`trim().slice(n)`); if those rules change, the mirrors must change too (a mismatch only reverts to the old behaviour for that field, never corrupts stored data). The typing tests would catch drift.
- Typing a leading space in a trimmed field now shows the space locally while the stored value stays trimmed (intended; same as existing `BufferedText` fields).
- Pre-existing, out of scope: repo-wide `tsc` errors in test files; ESLint v10 config absent.

## 7. Next action
Review + CI, then a 5-minute manual smoke in a browser: type Arabic text with spaces in the announcement bar, type an Instagram URL, toggle a social link, Undo/Redo. Merge/deploy remain with the owner.
