# CUST-HV V5d-2 — ColourField, Design inspector, copy / paste / reset, palette editor — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V5d-2** — second part of V5d (V5d-1 server gate ✓ → **V5d-2 authoring UI** → V5d-3 V1B items) |
| **Branch** | `cust-hv/v5d2-design-inspector` |
| **Authority** | V0 §3.4 (per-type registry), §4.1 (palette roles), §4.5 (one contrast algorithm), §3.5 |
| **Depends on** | V5a · V5b · V5c · V5d-1 |

Until now `section.design` could only be written by hand. V5d-2 is the first slice where a merchant can author it — and every control is constrained by the contract the earlier slices proved.

---

## Implemented

### `ColourField`
Role swatches (`brand · accent · surface · surfaceAlt · text · heading · link · border · overlay`, each showing the colour it resolves to *now*), a native picker + hex field (validated `#rrggbb`, lower-cased, with an explained error — never a CSS string), recent colours, clear, and a verdict line.
- A **role** is stored as a *reference* (it follows the palette when retuned); a **hex** is a fixed colour — exactly V0's `ColorRef`.
- Recents live in `localStorage`, every access guarded (blocked storage never breaks the field; tested).
- `hexOnly` mode (used by the palette editor, where a colour *defines* a role).

### Design tab (Content | Design) in the section inspector
`DesignInspector` offers **only** what the section's type declares (V0 §3.4) **and** the renderer supports today (typography waits for V5e): background (none / solid / gradient with an 8-direction logical selector), text colours + alignment, spacing, max-width and the full-width band (solid only — a gradient does not bleed), border (+ colour), corners, shadow. Every edit goes through `normalizeSectionDesign`, so what is stored is exactly what the server keeps (defaults never stored, fixed key order, empty groups omitted).
- **Live contrast verdict = the publish gate.** The field calls `sectionContrastIssues` (the V5d-1 twin of the PHP gate), so the merchant sees the *same* result the server will enforce: an explicit colour below 4.5:1 shows the ratio, says it cannot be published and offers **"Use the clearest"** (the automatic white/black proven on the whole background range); a gradient no neutral can be proven on is flagged on the background itself.
- **Automatic is first-class:** with a background and no text colour the field shows "Automatic (clearest on the background)" with the colour in use.
- **Dark-surface sections** (`hero`, `appPromo`, `wholesale`) disable text colours with an explanation until a background exists (the V5c review rule) — the UI never offers what the renderer ignores.

### Copy / paste / reset
In-memory clipboard (never part of the document, never persisted across sessions). **Paste goes through the target type's normaliser**, so a design copied from a banner lands on a shelf with only what a shelf can render (tested: border/radius dropped). **Reset is two-step** (confirm / cancel); both announce through a polite live region.

### Palette editor (Theme panel)
Seven role colours (hex only, clearable). An unset role shows today's fixed token as the value in use (V0 §4.1: absent ⇒ unchanged). Writes through `normalizePalette`.

---

## Design Quality Pass

Real browser, the actual builder (`/dev/customizer-versions`), **12/12** at 390 · 430 · 768 · 1024 · 1280 · 1440 × AR RTL / EN LTR (`web/e2e/cust-hv-v5d-design-inspector.spec.ts`); evidence `docs/plans/store/cust-hv-v5d/*.jpg`. 768–1023 has no inspector on `main` (**DEF-7 — V5d-3/V1B**), recorded as an annotation.

| Check | Result |
|---|---|
| Flow in the browser | add hero → Design → Solid → failing explicit colour is flagged → "Use the clearest" fixes it → role swatch by **keyboard** → copy → reset (confirm) → paste restores |
| Overflow / clipping | no added horizontal overflow; inspector inside the viewport. **The evidence run caught a real defect:** `<fieldset>` has `min-inline-size: min-content`, so the swatch row and segmented control were clipped at the panel edge in Arabic at 1280 — fixed (`min-w-0`), asserted from then on |
| Touch targets | swatches 36 px (asserted ≥ 32), 44 px bottom-sheet rows unchanged |
| States | empty (no design) · explicit-fail · ok · unprovable gradient · disabled (needs background) · clipboard empty / filled · reset confirm · blocked storage |
| Terminology | merchant words only — "Design", "Background", "Clearest", "Corners"; no `role`, `hex`, `ColorRef`, ratio codes |
| Tokens | semantic tokens only; **drift ratchet green** (the first cut used neutral/red/emerald palette classes and a raw hex; both removed) |

---

## Invariants

| Invariant | Status |
|---|---|
| Tenant Isolation / auth / RBAC | No route, model, query or migration. Edits only the Draft document through the existing save path. |
| Draft vs Published / concurrency | Untouched; the server gate (V5d-1) is the authority — the editor verdict is advisory and cannot be bypassed. |
| Media ownership | No media in `design` (fail-closed until V6). |
| Commerce / accounting | Untouched. |
| Backward compatibility | Sections without a design are untouched; a type with no capability shows "no design options" instead of empty controls; `PRESENTATION_CONFIG_VERSION` stays 3. |
| Accessibility | Every control is a real button / select / input with a name; verdicts are `role=alert` / `status`; swatches are `aria-pressed`; contrast shown is the proven one. |

## Verification

| Gate | Result |
|---|---|
| New web tests | `DesignInspector.test.tsx` **17** (field: role reference, hex validate + recents, clear, blocked storage · inspector: capability filtering, no-capability type, solid/auto, failing-colour + one-tap fix, unprovable gradient, dark-surface disable, bleed only for solid, enumerated writes, copy→paste (capability filtering) → two-step reset, paste disabled · palette set/clear · Content↔Design tab reaching the document · AR/EN key parity) |
| Web | store-experience-builder **59 files / 892 tests ✓** · `src/design` governance (drift ratchet) ✓ · `tsc` clean for the touched module |
| Browser | `cust-hv-v5d-design-inspector.spec.ts` **12/12** |
| Backend | no `app/` change in this slice; V5d-1's gate + presentation suites 298 ✓ (full run on the V5d-1 base: 5775 passed, 28 env-only Fuel* failures identical to `main`) |

## Limitations / next

- **Typography, buttons, surfaces, separators, overlap, motion** — V5e (the inspector will gain those groups when their renderers exist).
- **`width.mode = wide`** is not offered (rendered as contained until the container is restructured).
- **768–1023 has no editing surface** (DEF-7) and the accent chrome / delete confirmation / Canvas width items (DEF-2/6, BL-4) are **V5d-3 (V1B)**.
- A merchant who clears *every* group still gets an empty `design` omitted by the normaliser — by design (absent ⇒ legacy).

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
