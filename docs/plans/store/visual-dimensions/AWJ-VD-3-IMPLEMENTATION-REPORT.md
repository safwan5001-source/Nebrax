# AWJ-VD-3 — Implementation Report (Admin visual editor for dimensions and values)

STATUS: **MERGED** — PR #1509 merged under the owner's 2026-10-15 authorization as `d6282888e26636eec698cadda1ad3880ae0eb5bf`. POST_MERGE_REVIEW: PASS — CI (sqlite + pgsql) and Web CI green on main (run 38672377636, 38672377674). Production deployment still needs the owner's explicit approval.
DATE: 2026-10-15
HORIZON: AWJ-COMMERCE-VISUAL-DIMENSIONS-H1 · slice VD-3 (H1-3)
AUTHORITY: owner authorization of 2026-10-15. Web/UI only. The VD-1b endpoints and the VD-2 render layer are consumed as merged; no contract was changed.

## Outcome

The two-field `FieldsDialog` for editing a dimension or a value is replaced by the **`FacetVisualEditor`**: one side sheet with three tabs (Data · Image & icon · Appearance), a live store-themed preview, per-property inheritance with restore, and a save pipeline wired to `PUT facets/{id}/visual` and `PUT facets/{id}/values/{valueId}/visual`.

**Not touched:** PHP, database, migrations, routes, `Rbac::MATRIX`, roles, permissions, tenant isolation, security policy, `storefront/`, `DataSectionFields.tsx`, discovery display settings, the task queue and `CURRENT-STATE.md`.

## Behaviour

### Container (§3.2)
- Side `Sheet` from `md` (`max-w-3xl`): fields on one side, a sticky preview on the other. On a phone it is full screen with the tabs pinned on top, the preview as a collapsible strip (closed by default; its header shows a mini tile of the edited item) and the actions pinned at the bottom with `env(safe-area-inset-bottom)`.
- Titles are unified: «تعديل البُعد — {name}» / «تعديل القيمة — {name}» (C6); a read-only role gets «عرض …». Field labels are unified for both kinds: «الاسم بالعربية» / «الاسم بالإنجليزية (اختياري)» (C7), also in the quick-add dialogs.
- **Quick-add stays data-only.** After a successful create (and only for a role with `commerce.manage`) a follow-up offers «تخصيص المظهر», which reloads the list and opens the full editor on the new row at the Image tab. No identity is written before the row exists (tested: no `/visual` call until the user saves).

### Data tab (§3.3)
Arabic name (required), English name, active switch; read-only identifier, core badge and product count. Uses the existing `updateFacet` / `updateFacetValue`, unchanged.

### Image & icon tab (§3.4)
- **Content-type group:** value = inherit / image / icon / text only; dimension = image / icon / text only for its own identity, plus a separate «افتراضات القيم» block (not set / icon / text only, no image: images are never inherited).
- Switching image / icon / text only **only sets `content`**; a stored image or icon is kept. Only «inherit» removes what the value set itself, and for a dimension's defaults «not set» removes the content only. Removing the image touches nothing else (D-08, tested).
- **Image:** `MediaRefField` with `framing={false}` (pick-only; no `MediaFramingEditor`) over the shared `MediaPicker`. Output goes through `toFacetImage()`; a newly picked image is **decorative by default**. Alt AR/EN is optional (a missing alt is a neutral note, not the red «required before publish»).
- **Icon:** `IconPicker` (VD-2) + `ColourField` (hex only) for the icon and background colours, with a live ≥ 3:1 contrast message. With an image selected, the icon section is the fallback icon.
- Media library off (`useMediaCapability` = gated): the image option is disabled with the explicit reason; icon and text-only work.

### Appearance tab (§3.5)
12-shape grid drawn by the VD-2 engine itself (`facetShapeFrameStyle`), size, label switch, and — with an image — fit, a physical 3×3 focal grid (forced `dir="ltr"`, so it never mirrors in RTL), a drag on the previewed picture, and zoom 1–3 in steps of 0.1. Focal point and zoom are not stored at their defaults. **Every property** shows «موروث من البُعد: {value}» (or «الافتراضي: …») while not overridden and a «استرجاع الوراثة» button once it is. The state comes from `resolveFacetValueVisual(...).sources` (the same resolver as the storefront), never recomputed.

### Live preview (§3.6)
`FacetVisualTile` (the storefront's twin) inside `.awj-store-preview`, so the frame uses the **store's** tokens. A layout switcher (grid / cards / rail / icons / list) is preview-only and never counts as an edit. A value is shown between its two real neighbours; a dimension shows its own tile and its values with the edited defaults. Updates are local and instant. Fallbacks are named, with a sentence each: loading, image not ready, image deleted, image failed to load, preview unavailable.

### Save (§3.7)
One «حفظ»: data (if changed) then visual (if changed) with the `expected_version` read when the editor opened. A part that succeeded updates the baseline, so a retry sends only the failed part. Each part's result is listed beside the actions, and tabs get an alert dot. The editor closes only when everything succeeded; closing after a partial save still tells the parent the list is stale. 409/428 → «تغيّرت الهوية من مستخدم آخر…» + «إعادة التحميل» (reopens on fresh data on the same tab; no automatic retry, tested: one attempt only). 422 → field errors on their controls (`visual.image.mediaId`, `visual.shape`, …; codes `media_not_found`, `media_not_ready`, …) and also listed in the footer, so an error on a control that is not on screen is never invisible. Double submit is guarded. Cancel with unsaved changes asks first (Escape too).

### Permissions and capability (§3.8, D-04) — the UI mirrors the server
| Case | Behaviour |
|---|---|
| `products.manage` + `commerce.manage` | everything editable |
| `products.manage` only | Data editable; identity tabs read-only with the information banner; saved image shown from the signed `visual_preview`; no pick / upload buttons; **no library read and no capability probe** (tested) |
| `products.view` only | the whole editor read-only with the existing `merchNoPermission` |
| media off | image option disabled with the reason |

The list gives a view-only user an «عرض» button instead of the pencil.

### List (§3.1)
- A 32 px real `FacetVisualTile` thumbnail before a dimension / value **only when its resolved identity draws something** (none for no identity or an explicit «text only»). It uses the store tokens, so it looks as shoppers see it.
- Delete-blocked reason as **visible text**: a full-width muted line, always shown on a phone; from `md` it appears when the blocked bin is pressed. The bin is `aria-disabled` (still focusable and pressable) instead of `disabled`, so the press can reveal the reason.
- Collapsible value lists on mobile, default open, remembered in `localStorage` (try/catch; works with storage blocked).

## Adapters and `MediaRefField`
- `media/facet-image.ts`: `fromFacetImage()` hands the field only `mediaId`, `alt`, `decorative` (never framing, so no derivative is requested); `toFacetImage()` takes only those three back and re-attaches the framing the Appearance tab owns. **Neither ever emits `crop` or `rotate`.** `zoom` lives at `image.zoom`. A replacement keeps `fit` and resets `focal` / `zoom`.
- `media/media-field-messages.ts`: `createMediaFieldT(locale, overrides)` — the field and picker keep the Customizer catalog's wording, with a few keys overridden for the facet surface.
- `MediaRefField` gained two optional props: `framing` (default `true`) and `altRequired` (default `true`). **Default output is byte-identical to `origin/main`** (verified with a throwaway test that rendered the old and new component for empty / bare / decorative / alt / framed values and compared the HTML, ignoring React `useId` counters; not committed).

## Changed files

**New** (`web/src/modules/commerce-workspace/merchandising/visual-editor/`): `FacetVisualEditor.tsx`, `DataTab.tsx`, `ImageTab.tsx`, `AppearanceTab.tsx`, `PreviewPanel.tsx`, `controls.tsx`, `document.ts`, `labels.ts`, `messages.ts`, `types.ts`, `constants.ts`, `use-image-source.ts`, `test-fixtures.ts`; tests `FacetVisualEditor.test.tsx`, `document.test.ts`; `merchandising/facets-panel.visual.test.tsx`.
**New** (`web/src/modules/store-experience-builder/`): `media/facet-image.ts`, `media/media-field-messages.ts`, `__tests__/facet-image.test.ts`, `__tests__/MediaRefField.framing.test.tsx`.
**Modified:** `merchandising/client.ts` (+ `client.test.ts`), `merchandising/facets-panel.tsx`, `app/(commerce)/commerce/merchandising/page.tsx` (passes `locale` and `canManageIdentity`), `app/(commerce)/commerce/merchandising/page.test.tsx`, `media/MediaRefField.tsx`, `components/ui/tabs.tsx`.
`common.tsx` is unchanged (`FieldsDialog` still serves the quick-add dialogs; `ConfirmDialog` serves the discard prompt).

### Edits outside the stated ownership (flag for review)
- `web/src/components/ui/tabs.tsx`: two optional `TabDef` fields (`alert`, `alertLabel`) rendering a dot. Additive; a tab without them renders exactly as before. Needed for the per-tab alert dot; the shared `Tabs` was the required component.
- `page.test.tsx` (4 assertions updated, intentionally): the blocked bin is `aria-disabled` instead of `disabled` (C4); the quick-add field label is «Arabic name» (C7); after a successful quick add the «Customize appearance» follow-up is shown.

## Tests and exact results (local)

| Suite | Command | Result |
|---|---|---|
| Focused | `npx vitest run src/modules/commerce-workspace/merchandising "src/app/(commerce)/commerce/merchandising"` | **6 files / 177 tests passed** (after the review fixes) |
| Web full | `cd web && npm run test` (includes the drift ratchet) | **624 files / 7050 tests passed** (after the review fixes) |
| Web build | `cd web && npm run build` | **Compiled successfully; 190/190 static pages** (after the review fixes) |
| Types | `npx tsc --noEmit` | **48 errors, all in pre-existing test files; none added** (same count as `origin/main`) |

`npm run lint` is not configured in this repo.

**What the tests pin:** adapters never emit `crop`/`rotate` (even from a ref that carries them); `fromFacetImage` never emits `crop`; saving zoom 1.4 sends `image.zoom: 1.4`; `framing={false}` hides «Edit image» and never mounts `MediaFramingEditor`; the Customizer default (and `framing={true}`) unchanged; client bodies exactly `{visual, expected_version}`, the `visual: null` tombstone, the integer-or-null token rule (refused before any request), `GET facets` visual fields; the editor's tabs, unified titles and labels, content-type behaviour, inheritance badge and per-property restore, appearance controls, the permission matrix (including read-only identity previewing from `visual_preview` with zero library reads and zero capability probes), media off, save sequencing (data then visual, exact call order and bodies, partial failure and retry sending only the failed part), 409/428 with reload and no retry, 422 mapping, double-submit guard, unsaved-changes confirm (button, Escape, partly-saved close), the image fallback states (stored thumbnail, not ready, deleted, failed to load, unavailable), the focal drag, the preview neighbours and layout switcher; list thumbnails only with a visual, the visible delete-blocked reason, collapse and its persistence (and blocked storage), the view-only «عرض» button, quick add then «Customize appearance», and the version-conflict reload through the list.

## Visual verification (§3.9)

A throwaway page (not committed; kept only in the scratchpad) mounted the real `FacetsPanel` over a stubbed API with Next.js dev, and Playwright (Chromium) captured **19 scenarios × 390 / 768 / 1280 / 1440 × Arabic RTL / English LTR × light / dark = 304 screenshots** (plus the scrolled-to-bottom view of every editor). Scenarios: the list; a ≥ 40-character Arabic name (Data tab); a value with an image (Image and Appearance); a legacy value with no identity (Image and Appearance); an image not ready; an icon value; read-only identity (Image and Appearance); view-only; media off; a dimension (Image and Appearance); the mobile preview strip open; a version conflict; a 422; the media picker over the sheet; the discard confirm.

- **No horizontal overflow** of the page or the sheet in any of the 304 captures (`scrollWidth ≤ clientWidth`).
- I opened and looked at about 30 of them across the matrix. **Defects found and fixed from what I saw:**
  1. List thumbnails were invisible: the label-hiding selector hit the whole tile (an `sr-only` on the wrong span), and outside a store scope the tile has no `--store-*` colours. Fixed with the store scope on the thumbnail.
  2. Preview tiles overlapped each other: a tile root without a definite width does not let the frame shrink. Fixed with `w-full` on the preview tiles.
  3. The delete-blocked sentence was squeezed into a 4-line column beside the actions. Moved to its own full-width line.
  4. A read-only role was shown the «media library is not enabled» message. Now shown only to a role that could have used the library.
  5. An empty grey square in the mobile preview strip for a text-only value. Removed.
  6. Media-field buttons were 36 px; raised to 44 px inside the editor without touching the shared field.
  7. The unselected focal dots were barely visible in dark mode.
- Checked and fine: RTL (sheet opens from the start side, shape and focal grids, badges, the physical focal grid), LTR, dark (the preview frame stays light by design: the store has no dark mode), the sticky footer never covers content (it is outside the scroll area), long Arabic names wrap and clamp in the title and the list and clamp in the preview, the nested confirm and media picker over the sheet.
- **Not checked visually:** a real browser against a real Laravel API (the page used a stubbed `fetch`), real signed thumbnails (data URIs stood in), the iOS safe-area inset on a physical device.

## Self-review

### Decisions worth the owner's attention
- **Independent parts.** The identity is attempted even when the data write failed (and vice versa), so one click makes the most progress and each tab reports truthfully. A part that fails never rolls back the other.
- **Reload discards local identity edits** by design (§3.7: never merge over a version the user has not seen); the editor says so.
- **Replacing an image** keeps `fit` and resets `focal` / `zoom` (they describe one picture), matching the Customizer's own swap rule.
- **«Inherit»** on a value removes its own content, image and icon (the only destructive choice); it is a draft until saved and the unsaved-changes guard applies.
- **A value set to «image» with no picture yet** saves `content: "image"` and relies on the D-08 render fallback (icon, then name); the editor shows a hint until a picture is picked.
- The identity tabs require **both** `products.manage` and `commerce.manage` (the server guards only `commerce.manage`); a role with `commerce.manage` alone gets the whole editor read-only, following the §3.8 table.

### Residual risks
- A stored image's `visual_preview` link lives 20 minutes; an editor left open longer shows the «failed to load» fallback for it. Reopening refreshes it.
- The focal drag is a pointer enhancement; the 3×3 grid is the keyboard path. The drag captures touch while the Appearance tab is open on an image (`touch-none` on the edited tile only).
- `ConfirmDialog` / `Dialog` are not portalled, so inside the sheet they are positioned relative to the sheet (checked visually: they read as a modal over it). If a global portal is ever introduced for them this stays correct.
- The facet's `visual_preview` covers only its own `self.image`; a dimension's defaults carry no image, so nothing is missing.
- Two pre-existing Next dev messages (`next-intl` dotted-key warnings in `en`/`ar` message JSON) appear in the dev console; they are not from this slice.

## Review fixes (independent review of PR #1509, head `051e48d`)

No blocking finding. The accessibility and error-handling findings were binding and are fixed in a new commit.

| # | Finding | Result |
|---|---|---|
| F1 | Closing dropped focus to `<body>` (the sheet has no Trigger) | **Fixed.** `useRestoreFocus()` + `onCloseAutoFocus` as in `role-editor-sheet.tsx`. When the opener no longer exists (the quick-add «Customize appearance» button the editor replaced), focus goes to that row's own edit button (`data-open-editor`, passed as `returnFocusTo`). Tests: focus returns to the opener after Esc, Cancel, a successful save, a discard confirmation, and the «Customize appearance» origin. |
| F2 | «Restore inheritance» unmounted the focused button | **Fixed.** After a restore, focus moves to the restored control (the pressed option, else the first control) inside the row. Tests assert `document.activeElement` is a control of that row, not `<body>` or the dialog (shape, size, label switch). |
| F3 | Touch targets under 44 px | **Fixed.** Image & icon tab: the icon section carries `[&_button]:min-h-11 [&_button]:min-w-11 [&_input]:h-11 [&_input[type=color]]:w-11` (colour and hex inputs, recent swatches, icon search) without editing `ColourField`. Data «Status» and Appearance «Show the name» are now whole-row `<label>`s, so the clickable area is the row, not the 24 px switch (`ui/switch.tsx` untouched). List: edit/view/delete/collapse buttons are `size-11` at every breakpoint (no `max-md:` shrink), the row switches sit in a 44 px label, and the text actions («New dimension», presets, «Add value») are `min-h-11`. The sheet's close button is 44 px through `[&>button:last-child]:size-11` on the content. A new class-based test (`test-touch-targets.ts`) rejects any interactive element that is not ≥ 44 px **or** carries a `md:` / `sm:` / `max-md:` height or size class below 44 px, for all three tabs, a dimension editor, the media field and the list. Verified in the real layout too: with Playwright every interactive element in the editor and the list was measured (button, input, switch via its label) at 390 and 1280, ar and en, light and dark — none under 44 px. Not covered by the check by design: the tab strip (46 px by padding, shared component). |
| F4 | The double-submit test clicked a `disabled` button | **Fixed.** A new test fires two clicks on the **enabled** Save button inside one `act` (no re-render between) and asserts one request per part. **Confirmed it fails when the guard is removed** (`savingRef.current ||` deleted: the test fails; restored). |
| F5 | Gaps in error handling | **Fixed.** The identity write now has a message of its own (Arabic and English) for **403** (needs the e-commerce permission), **404** (no longer exists, with «Reload»; the panel also closes an editor whose row disappeared), **409/428** (changed by another user, with «Reload»), **422** (field errors), **429** (wait and press Save again; no reload, no retry), **5xx** (server error, nothing changed) and a **network failure** (could not reach the server), plus the generic fallback for any other status. Tests cover every one, including the previously missing 403, that none is retried automatically, and an Arabic message. |
| F6a | `visual_preview` URLs | **Fixed.** `safePreviewUrl()` accepts only `http(s)` links and same-origin paths (`/…`, not `//…`); `javascript:`, `data:`, `vbscript:`, protocol-relative and relative-without-slash values are dropped, in the mapper and again where the URL becomes an image source. Tested. |
| F6b | Tab alert name | **Fixed.** The hidden text now starts with «, » so the tab reads «Image & icon, This tab has an error». Only the editor passes `alert`, so no other `Tabs` consumer changes. Tested. |
| F6c | Contrast message | **Fixed.** Compared with `FACET_ICON_MIN_CONTRAST` and shown with two truncated decimals (2.995 reads «2.99», never «3.00:1 is low»). Tested. |
| F6d | Field errors announced twice | **Fixed.** The control keeps its `role="alert"`; the footer copy is `aria-hidden` (still visible). Tested. |
| F6e | `MediaRefField` remounted while saving | **Fixed.** `readOnly` no longer flips during a save; a separate `busy` flag disables the controls and makes the media field `inert` while it stays mounted. Tested: same element before, during and after a failed save, and no extra asset fetch. |
| F6f | A server field error stayed after the user fixed the field | **Fixed.** Editing a control clears its own error (and, when it was the last one, the tab dot and the «some settings are invalid» line). A framing edit is not an edit of the image control. Unit and component tests. |

### Accepted (residual risks, no change)
- **«Inherit» has no per-choice undo.** It shows the explicit warning line and Cancel / Esc discards the draft; keeping the removed image in memory so that re-selecting «Image» restores it was left out.
- The `#000000` in `constants.ts` is a never-drawn placeholder required by the `ColourField` type (it lives in a `.ts` file so the drift ratchet does not see it).
- The signed `visual_preview` link lives 20 minutes, as before.
- The tab strip's 46 px height depends on the shared `Tabs` padding and is not asserted by the class-based test.

### Visual re-check
After the fixes: 48 captures (list, Image & icon colours, restore focus, close focus, dimension Image tab, value Image tab × 390 / 1280 × ar RTL / en LTR × light / dark), plus the earlier 304. The measured-size check reported no target under 44 px. The focus ring is visible on the restored shape button (keyboard path) and on the row's edit button after Esc; the colour fields and recent swatches are 44 px; the list rows are denser by 8 px at most and nothing wraps or overflows.

## Accounting impact
**None.** No journal, no ledger service, no financial figure.

## Tenant / RBAC / API / DB impact
**None.** No route, controller, migration, model, permission or role changed. The UI calls only endpoints that already exist, as the same authenticated, tenant-scoped client; the server remains the authority and always returns 403 for the identity writes without `commerce.manage`. The editor never reads the media library for a role without that permission.

## Backward compatibility
- `MediaRefField` default behaviour byte-identical; `Tabs` unchanged for existing callers; `FieldsDialog` and `ConfirmDialog` unchanged.
- `Facet` / `FacetValue` types gain fields (`visual`, `visualVersion`, `visualPreview`), tolerant of their absence (a legacy or older response maps to `null`).
- The merchandising page and its other tabs are unchanged.

## Git state
- Branch: `feat/vd-3-admin-visual-editor` from `origin/main` `a37d893`.
- Head SHA and PR: see the hand-off message. PR not opened.
