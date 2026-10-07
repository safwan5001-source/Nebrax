# CUST-HV V5e-1 — Section typography (rendered + authored) — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V5e-1** — first part of V5e (V5e-1 section typography → V5e-2 global tokens: typography / buttons / surfaces / content width / motion → V5e-3 separators, overlap, one-time reveal) |
| **Branch** | `cust-hv/v5e1-section-typography` (stacked on V5d) |
| **Authority** | V0 §3.3 `typography` group, §5.2 (named steps resolved by the renderer, never pixel inputs; Arabic letter-spacing never exposed) |
| **Depends on** | V5b (contract — already accepts `typography`) · V5c (resolver / frames) · V5d (inspector) |

The `typography` group has been accepted by the contract since V5b and deliberately *not* rendered (V5c). V5e-1 renders it and lets the merchant author it. **No contract change, no new normaliser, no PHP change** — the document, fixtures and gate are untouched.

---

## Implemented

### Resolver (twins, byte-identical) — named steps only
| Field | Steps | Output |
|---|---|---|
| `headingScale` | sm · **md (= today, emits nothing)** · lg · xl | `--sec-hs` fluid `clamp()` |
| `bodyScale` | sm · **md (= today)** · lg | `--sec-bs` |
| `headingWeight` | 400 · 500 · 700 · 800 | `--sec-hw` |
| `lineHeight` | tight · normal · relaxed | `--sec-lh` (1.25 / 1.5 / 1.75) |
| `headingStyle` | bar · plain · centered · underline | `data-sd` token `hstyle-*` |
A design whose only typography is the default (`md`) still yields **no wrapper** (absent ⇒ legacy). Values are validated tokens — a test asserts no `url`/`;`/braces ever appear.

### Stylesheet (twin blocks, test-enforced equal modulo the preview scope)
Applies to **section-level** text only (never inside a surface nested in the section — same structural rule as colours). Heading styles: `plain` / `centered` / `underline` step the shared rule bar aside (`data-heading-bar`, `data-section-heading` on the shared heading in the storefront and the Canvas); `centered` centres the heading block; `underline` draws a primary-colour rule under the heading; `bar` gives headings that lack one the same bar and leaves the shared one alone.

### Inspector
The Design tab gains a **Type and headings** group with exactly the fields the section's type declares (e.g. a product shelf offers only *Heading style*; benefits / banner / hero / custom content offer all five), as selects of named steps; weights are stored as real numbers.

---

## Proof

| Gate | Result |
|---|---|
| Real browser | the V5c render-proof now asserts, at six widths × AR/EN, that an `xl` heading really is larger (≥ 22 px), weight 700 is applied, `underline` draws a bottom rule, `centered` centres, and `plain` hides the bar — a mutation run (rules removed) fails it with *"underline heading has no underline"* / *"xl heading is only 16px"*, so it is not vacuous. All 13 pass; the earlier contrast / overflow / root-surface assertions still hold with the typography on |
| Unit | resolver +2 (typography steps; defaults emit nothing) · inspector +1 (allowance per type, numeric weights) |
| Web / Storefront | web builder + governance green · storefront `biome` + `tsc` ✓ |

## Invariants

| Invariant | Status |
|---|---|
| Tenant Isolation / auth / RBAC / Draft-Published / concurrency | Untouched (rendering + authoring of an already-validated group). |
| Backward compatibility | Absent `typography` ⇒ no attribute, no variable, no rule applies. `PRESENTATION_CONFIG_VERSION` stays 3. |
| Accessibility | Larger/heavier headings never reduce contrast (colour is judged independently by the V5d gate); `lineHeight` is available for the Arabic `relaxed` default; no letter-spacing is offered. |
| Commerce / accounting | Untouched. |

## Limitations / next

- **Global typography tokens** (`headingFamily`, global scales, `buttonText`) and the self-hosted font catalogue are **V5e-2** (they need document-level contract ×3 and font assets); only the section-level steps ship here.
- `bodyScale` sets one size for the section's paragraphs (a hierarchy of `text-xs` / `text-sm` inside one section flattens while a step is set) — the default (`md`) leaves the mix untouched.
- **V5e-2**: buttons, surfaces, content width, global typography, motion tokens. **V5e-3**: separators, overlap presets, one-time reveal.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
