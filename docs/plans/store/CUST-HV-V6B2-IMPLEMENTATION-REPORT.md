# CUST-HV V6b-2 — Media background contract + contrast publish gate — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V6b-2** — second part of V6b (V6b-1 evidence ✔ → **V6b-2 contract + publish gate** → V6b-3 rendering → V6b-4 inspector → V6b-5 real-pixel proof) |
| **Branch** | `cust-hv/v6b2-media-contract` (stacked on V6b-1 until #1277 merges; rebuilt on `main` afterwards) |
| **Authority** | V0 §3.2.1 (media background proof) · §4.5 (contrast) · §8.1 (hero media) · §2.2 (additive, three normalizers in lock-step) · AMEND-8 / AMEND-9 |
| **Depends on** | V6b-1 (`region_luminance` pixel evidence) |

---

## Implemented

### Contract (PHP authority + web twin + storefront twin, one shared fixture)
`section.design.background` gains a third kind, **hero and banner only**. Additive and optional; version stays 3; a document without it is byte-identical.

```ts
background = { kind: "media",
               media:   MediaRef,                 // required — else the whole background drops
               mobile?: MediaRef,                 // optional phone-width picture (art direction)
               overlay?: { color: ColorRef,       // default { role: "overlay" }
                           alpha: 5|10|…|90 } }   // percent, steps of 5, capped at 90
```

| Rule | Behaviour |
|---|---|
| **Per-kind capability** | The registry's `background` allowance is now an explicit kind list: `["solid","gradient"]` everywhere, `["solid","gradient","media"]` for `hero`/`banner`. Every other type drops a media background (fixture cases ×8). Snapshot fixture updated in the three normalizers. |
| **A picture is decoration** | Background references are normalized to `decorative: true`, with `alt` and `fit` removed — no alt text is demanded for a background, and `fit: contain` (letterboxing that would reveal a surface the evidence does not cover) cannot be stored. `focal` / `crop` / `rotate` are kept (the derivative path and its own evidence apply — AMEND-8). |
| **Fail-closed, field by field** | Missing / malformed `media` ⇒ the *whole* background drops; a malformed `mobile` drops alone; an overlay alpha outside the 18 allowed steps (0, 7, 95, 100, −5, `"40"`, `null`, `true`) drops the overlay alone; an unsafe overlay colour falls back to `{role:"overlay"}`; URLs / styles / extra keys on the reference never survive. |
| **Key order** | `kind · media · mobile · overlay`; reference keys `mediaId · focal · crop · rotate · decorative`. Idempotent (asserted for every case in all three twins). |

### Contrast publish gate
`SectionDesignContrast` (PHP) and `section-design-resolve.ts` (both TS twins, byte-identical) gain a **media branch**:

- The judged interval is the **union of the bounds of every picture that can be shown** (default + phone), composited under the overlay via `ContrastEngine::channelBoundsInterval` (per-channel min/max → luminance is monotone per channel, so the extremes bound every displayed pixel).
- **Unprovable = non-conforming.** A picture with no usable evidence (absent, pending, failed, translucent, malformed, unknown version, asset not active/ready) makes the *background* `contrast_unprovable` **whatever the text colours are** — checked before the text, because the latent hole found in V6b-1 (`backgroundInterval()` returning `null` for an unknown kind lets a surface-owning hero pass silently) must not exist for the new kind. A distinct merchant message: *“can't prove the text is readable over this picture — add a darker overlay or choose another picture.”*
- Automatic foreground, explicit body / heading / link and the two-field reporting (`background` for an unprovable automatic colour, the text field for an explicit failure) reuse the existing flow unchanged.
- **Evidence source:** `StorefrontMediaContrastEvidence::boundsFor(MediaRef)` — read-only (AMEND-9, nothing is generated from the publish path). Default frame ⇒ the asset's evidence; a transformed frame ⇒ the union over **all** ready rows of that usage's derivatives, each measured on the rendered transformed frame (AMEND-8). Bounds are widened by the code's encoding margin; a margin stored in the row can never narrow the proof.
- `StorefrontPresentationPublishValidator` passes a **lazy** closure — documents without a picture background never touch the media tables.
- TS twins take the already-widened bounds through an optional `DesignContext.mediaBounds`; absent ⇒ unprovable. (V6b-4 supplies it from a read-only API field; no `region_luminance` is exposed.)

### Merchant app (compile-level only)
`DesignInspector` reads an API-authored picture background as "none" in the kind selector (the picture control is V6b-4); no crash, no write.

---

## Proof

| Gate | Result |
|---|---|
| Normalizer parity | `section-design.json` +~22 cases (default/mobile/overlay, canonical order, every bad alpha, unsafe colour, malformed pictures, url/style stripping, 8 non-hero types) — PHP `StorefrontSectionDesignTest` 5/5, web 72/72, storefront 72/72 |
| Contrast parity | `section-design-contrast.json` +15 media cases (dark/light proven, full-range unprovable, weak vs strong overlay, palette overlay role, no/absent evidence, phone picture without evidence, phone widening, explicit white/dark text, heading+link, range-not-average) — PHP / web / storefront each 39/39 on identical expected values |
| Integration (real uploads, real derivatives) | `StorefrontMediaBackgroundContrastTest` 8: dark publishes; black→white unprovable until a 70 % overlay; phone picture judged; 7 kinds of bad/old evidence never proof; stored slack cannot narrow; unknown/deleted/unready asset; **cropped derivative proven on its own evidence** (a crop that includes one white column is correctly *not* provable) and a derivative row without evidence ⇒ unprovable; hidden sections never block, other types cannot carry a picture |
| Suites | storefront vitest 1513 ✔ · web `store-experience-builder` + appearance 1135 ✔ · tsc clean (changed files) · biome clean on changed files · PHP subset (Presentation / SectionDesign / Storefront / Commerce) — see PR |

## Design Quality Pass
No pixel is painted by this slice (the renderers ignore a picture background until V6b-3), so there is no visual surface to evaluate. The merchant-facing text added is the unprovable-picture message (AR; EN is carried by the V6b-4 inspector keys). Responsive / RTL / state evidence for the picture itself belongs to V6b-5.

## Invariants
| Invariant | Status |
|---|---|
| Tenant isolation | Evidence read through tenant-scoped models; asset must be `active` for the publishing tenant |
| Draft vs Published / publish safety | Drafts stay lenient; the **same** validator runs on every publish path (immediate, legacy, schedule, scheduled run) |
| Media ownership / published-reference gates | Picture references are ordinary `MediaRef`s: the scanner, publish gate, published index and reference guards pick them up unchanged |
| Backward compatibility | Additive; absent `design.background` unchanged; `background: true` capability replaced by explicit lists with identical effect for existing kinds; version 3 |
| Security | No URL / CSS / HTML accepted; alpha and colour are enumerations / validated hex; picture ids are UUIDs |
| Commerce / accounting | Untouched |

## Interim state (until V6b-3 — documented, not hidden)
A picture background can only be authored through the API today (no inspector control yet). The renderers do not paint it and do not pick a text colour for it (no `mediaBounds` ⇒ no interval ⇒ legacy surface rules), so a document that carries one renders exactly as one without. The publish gate still demands proof, so nothing unprovable can ship.

## Limitations / next
- **V6b-3** — render: published-media plumbing for backgrounds, `<picture>` with the phone source, overlay layer, LCP priority for the first hero, Canvas via `useMediaRefPreview`; the storefront needs the same bounds to choose the automatic text colour (carried in the resolved published media).
- **V6b-4** — inspector control (reuses `MediaRefField`), overlay colour / alpha, AR/EN, live contrast verdict via a read-only bounds field.
- **V6b-5** — real-pixel Chromium proof (six widths, AR/EN).

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
