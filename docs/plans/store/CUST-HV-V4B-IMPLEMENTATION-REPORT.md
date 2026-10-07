# CUST-HV V4b — MediaPicker, bounded Image Editor, per-usage readiness, identity-media migration — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V4b** — second half of V4 (V4a = `MediaRef` contract, resolution, rendering) |
| **Branch** | `cust-hv/v4b-media-picker-editor` |
| **PR** | see PR description (opened with this report) |
| **Base SHA** | `d740fb89` — `origin/main` after V4a (#1264) merged |
| **Authority** | V0 §7.6 (image editing), §7.7 (mobile override — see Deferred), §7.8 (Legacy), §7.10 (MediaPicker UX, AMEND-5/9/10/14); Master Execution §6 (V4) |
| **Depends on** | V2a/V2b/V2c (merged) · V4a |

**What this slice turns on.** Until V4b no merchant could create a `MediaRef`. After it, an owner/admin with the library enabled can pick or upload an image, frame it for **one placement**, give it per-locale alt text (or mark it decorative), watch that placement reach `ready`/`failed`, and replace the legacy embedded logo / compact logo / favicon with a library image — everything the V4a pipeline then publishes and renders. Still **flag-gated**: with `STOREFRONT_MEDIA_R2_ENABLED` off (Production default) every identity slot behaves exactly as before.

---

## Implemented

### 1. Web client — `commerce-workspace/storefront-media.ts`
One typed wrapper for the V2a/V2b endpoints (list · single read · upload · alt/name · retry · `ensure` / `status` usage). Maps defensively (unknown `variants_state` → `pending`), never carries a path/key, and `resolveAltCoverage` mirrors the Publish gate **per locale** (decorative › override › library *for that locale* › missing — Arabic never stands in for English). `mediaRefTransform(ref)` is the `MediaRef`'s framing fields verbatim, i.e. exactly `StorefrontMediaTransform`'s input — so there is **no TS twin of the key hash** to drift.

### 2. MediaPicker (Library | Upload) — V0 §7.10
Grid, debounced search, *unused only*, cursor paging, multi-file drag-drop upload (one request per file → per-file progress/result). Every state the contract names is real: loading · empty · no results · uploading · **processing** (`pending`, visible, Refresh) · ready · **failed + Retry** (`POST …/retry`) · network error (+ Retry) · permission denied (403) · **capability-gated** (`uploads_enabled=false`: explanatory notice, upload disabled). A non-`ready` asset is visible but **cannot be selected**. A stale-response guard ensures only the latest request writes state. Nothing renders a URL/path/key (asserted).

### 3. Bounded Image Editor — V0 §7.6
Per-**usage** (the library original never changes). Crop = the largest rectangle of an approved preset (**16:5 · 3:1 · 16:9 · 4:3 · 1:1 · 4:5**, plus *Original*) that is **moved, never free-resized**; zoom 1–4× (slider, ±, `+`/`-`); focal 0–100 by click on the result frame **or** a labelled 3×3 grid; fit cover/contain; rotate 90°; **Reset always available**; Apply/Cancel/Escape. Fully keyboard-operable (arrows nudge the crop, Shift = ×5). No filters/flip/shapes/resize handles. Pure geometry lives in `media/framing.ts` and is unit-tested, including that **every produced reference survives `normalizeMediaRef` unchanged** (defaults never stored, fixed key order) — what the editor emits is exactly what the contract normaliser would keep.

### 4. Per-usage readiness — V0 §7.10 / AMEND-21 consumer
`useUsageReadiness`: **on mount it only reads** (`status`, never generates); it generates only when the merchant changed the framing (600 ms debounce) or when a read says *absent* (a saved draft whose derivative was reaped) — one bounded request each. **Generation is serialised across every field** (one queue ⇒ a document with N usages is N sequential calls, as V2b specified). States `none · checking · processing · ready · failed`; **Retry re-runs only that usage**; a live lease elsewhere is polled (bounded, 2 s × 30); a network failure is a *failed, retryable* usage — never stuck. The previous ready preview stays visible while a new framing processes/fails.

### 5. Selected-media card + per-usage alt — AMEND-10 / AMEND-14
Thumbnail · name · dimensions · "used in N places" · **Edit image · Replace · Remove**; **decorative** toggle (hides both alt fields, one-line explanation, alt kept); per-usage **AR / EN** alt, each separately optional, each showing the *resolved fallback inline* ("will use the library text: …" / "no alt text for this language — required before publishing"). Replacing an image resets framing and alt (they described the old picture); only the semantic *decorative* choice survives. An asset deleted elsewhere shows a **"removed" placeholder** with guidance (the stale state) and disables editing.

### 6. Identity migration — fixes the V4a "inert until V4b" caveat
`LogoMediaSlot` per slot (logo / compact logo / favicon):

| State | UI |
|---|---|
| Library gated / probe fails | legacy upload, **byte-for-byte unchanged** |
| Library on, nothing embedded | the library field only (new images never go back into the document) |
| Library on, legacy embedded | legacy control **unchanged** + an explicit *"Switch to the media library"* action; choosing a library image clears **only that slot's** legacy value — an explicit merchant act, never a background rewrite (**no bulk rewrite**) |
| Reference set | the media field; removing it does **not** resurrect the legacy value |

The Canvas resolves the reference **read-only** to a signed, editor-only workspace URL (framed rendition when ready, else the base preview) and the reference wins over legacy — the same precedence as the published storefront. Publish rejections are translated per slot and locale (`Store logo: English alt text is required`), never a raw code.

### 7. One small, additive API: `GET commerce/workspace/storefront-media/{id}`
The field must show the selected asset (name, alt defaults, preview, usage count) without paging the library. Same narrow resource as the list, `commerce.manage`, self-service refused, **uniform 404** for foreign / deleted / unknown ids. No migration, no existing response changed.

### 8. Preview (Demo) mode
`lib/storefront-media-demo.ts` mirrors the endpoints in-memory (inline images, ready/processing/failed assets) so the whole flow can be reviewed — and visually verified — without a server. Demo-only; never reached otherwise.

---

## Design Quality Pass

Evidence: `docs/plans/store/cust-hv-v4b/*.jpg` (12 files); the full 6 widths × AR/EN matrix is the Playwright spec `web/e2e/cust-hv-v4b-media.spec.ts` (**12/12 passing**: 390 · 430 · 768 · 1024 · 1280 · 1440 × ar RTL / en LTR).

| Check | Result |
|---|---|
| Six widths × AR RTL / EN LTR | picker, selected card, editor, applied state captured at every width; **no added horizontal overflow** (asserted against the shell's own baseline) |
| 768–1023 | no inspector surface exists on `main` (**DEF-7, owned by V1B**) — recorded as an annotation, not worked around |
| Dialog direction | the dialogs are portalled out of the builder shell; the first evidence run showed an English builder rendering them with the page's RTL (mirrored columns, punctuation). **Fixed**: the dialog carries the builder locale's `dir`/`lang`; asserted at every width |
| Dialog placement | a directional-variant centring bug (off-screen at ≥1024 in LTR) was caught by the same run; replaced by physical centring, asserted inside the viewport |
| Phones | full-screen sheet; footer actions always visible; 44 px touch targets (36 px with a pointer) |
| States | loading / empty / no results / processing / failed / error / forbidden / gated / stale / uploading / per-file result — each a real, tested state |
| Keyboard & focus | Radix focus trap + focus return to the opener; Escape closes; arrows/`+`/`-` in the editor; every preset, snap and toggle is a real button/checkbox |
| Merchant terminology | "frame", "library", "decorative image", "alt text"; no `MediaRef`, `transform`, `derivative`, `usageKey` or error code anywhere |
| Tokens / governance | semantic tokens only (drift ratchet + Admin↔Storefront boundary suites pass) |
| Evidence-driven defects | (1) dialog direction, (2) dialog centring — both fixed and now assertions |

## Invariants

| Invariant | Status |
|---|---|
| Tenant Isolation | Every call is the existing session-scoped workspace API; the new read goes through the tenant scope (foreign id → uniform 404, tested). No tenant id/key/path from the client. |
| Auth / RBAC | `commerce.manage`; cashier → 403; unauthenticated → 401; self-service refused (tested for the new route). |
| Draft vs Published | Editing writes only the Draft document; nothing is published or made public here. Publish gate (V2c) is untouched. |
| Revision / concurrency | Saves go through the existing builder save path unchanged. Generation is serialised client-side and idempotent/leased server-side (V2b). Stale responses never overwrite newer ones. |
| Media ownership | Picker lists only the tenant's active assets; a non-`ready` asset cannot enter a design; deleting a referenced asset stays blocked (V2a). |
| Commerce / accounting | Untouched. No journal entries. |
| Backward compatibility | Library off ⇒ identity slots identical to today (tested); legacy values untouched until an explicit switch; one additive route; demo handler is demo-only. |
| Production infrastructure | None new. |

## Verification

| Gate | Result |
|---|---|
| New web unit/component | picker **9** · field **12** · editor **12** · branding slots **6** · geometry **9** · client/publish-issue/parity **8** = **56** |
| Web builder suites | 52 files / 756 tests ✓ · **full web vitest 422 files / 3607 ✓** (governance: drift ratchet, Admin↔Storefront boundary) |
| e2e evidence | `cust-hv-v4b-media.spec.ts` **12/12** (also asserts the Canvas shows the media logo ≥1024) |
| Backend | `StorefrontMediaApiTest` **+2** (single read: shape/usage/safe fields; uniform 404, role-gated) · `CommerceModuleBoundaryTest` ✓ |
| Full backend | see PR description; PostgreSQL by CI |
| Build | see PR description (`next build`) |

## Risks / deferred (stated, not hidden)

- **Optional mobile media override (V0 §7.7)** is **not** in this slice: it exists only for Hero/Banner/Slider media slots, which do not exist until V5/V6/V7. `MediaRefField` is slot-agnostic, so those slices add a second field with no changes here.
- **Toolbar-level readiness aggregate.** V0 asks for Publish-blocking state at the Save/Publish toolbar. Today the per-usage state is inline in its field and a Publish rejection is explained in the toolbar message (per slot and locale); a cross-panel aggregate chip needs the V5 inspector model and is deferred there.
- **Orphan frames.** Every saved framing mints a usage key; an edit that is never saved leaves a derivative row. V2b bounds it (200/asset, 4 000/tenant) and V2c's manual reconciler reaps it after 24 h.
- **Signed preview URLs** are short-lived; a very long editing session re-resolves them on the next read. Editor-only; never stored.
- **Crop UI is move-only by design** (V0: no resize handles); the crop size is the preset's largest rectangle, tightened with zoom.
- DEF-7 (768–1023 has no inspector) remains V1B's.

## Next dependency-safe slice

**V5 (+V1B co-design)** — Section Visual Contract, inspector organisation (Content / Design / Layout), palette roles incl. first-class `accentColor`, bounded typography, button/surface styles and the proven contrast-validation implementation. V6/V7/V8/V9 hold `MediaRef`s through the field built here.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
