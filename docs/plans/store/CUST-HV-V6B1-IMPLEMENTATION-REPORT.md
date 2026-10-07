# CUST-HV V6b-1 — Media pixel evidence (backend) — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V6b-1** — first part of V6b (V6b-1 evidence → V6b-2 contract + publish gate → V6b-3 rendering → V6b-4 inspector → V6b-5 real-pixel proof) |
| **Branch** | `cust-hv/v6b1-media-evidence` (from `main` after V6a) |
| **Authority** | V0 §8 (hero media / overlay contrast must be *proved*, never assumed) · AMEND-8 (derivative evidence is measured on the rendered transformed frame) |
| **Scope** | Backend only. No migration, no endpoint, no API-contract, no UI change. |

---

## Why this slice exists
A hero or banner with a media background needs text contrast proven against the pixels that can sit behind the text. The publish gate (V6b-2) can only prove what is measured, so the measurement must exist, be stored, and be versioned **before** any contract accepts `background.kind = media`. This slice produces that evidence and nothing else.

## Implemented

### Evidence model — `StorefrontMediaPixelEvidence`
Stored in the **existing** `region_luminance` JSON columns on assets and derivatives (no schema change):

```json
{ "v": 1, "basis": "frame" | "transform", "width": W, "height": H,
  "min": [r,g,b], "max": [r,g,b], "alpha": false,
  "slack": { "abs": 12, "ringing": 20 } }
```

- **What is measured:** the per-channel *encoded* minimum and maximum over every pixel of the widest served frame (≤ 1920 px). Whole-frame extrema bound *any* crop, `object-fit: cover`, `object-position` or viewport, because any displayed pixel is a convex combination of frame pixels — so the proof does not depend on where text lands.
- **Derivatives** (crop/rotate/etc.) are measured on the **rendered transformed frame** (`basis: transform`), never inherited from the source asset (AMEND-8).
- **Indexed images** are resolved through their palette (`imagecolorsforindex`), never by raw index (Codex P1); palette transparency raises the alpha flag.
- **Alpha ⇒ unprovable.** Any pixel with alpha beyond tolerance sets `alpha: true`; `bounds()` then returns `null` and the gate treats the media as unprovable.
- **Lossy-codec margin:** `bounds()` widens each channel by `12 + ceil(20 % of the channel range)` per side, clamped to 0–255. The stored `slack` is informational; the margin is always recomputed from the code, so a tampered or older value cannot narrow it. A wrong version, malformed shape or alpha ⇒ `null`.
- **Validated empirically** on real JPEG/WebP files produced from hostile images (hard 25|235 and 100|180 edges, noise): the observed ringing used ≤ 75 % of the margin.

### Generation
`StorefrontMediaVariantGenerator::generate()` scans after the first (widest) rung; `renderTransform()` scans the first rendered width. `StorefrontMediaService` and `StorefrontMediaDerivativeService` persist the result. API resources do **not** expose `region_luminance` (existing assertions retained).

### Backfill for existing media
`StorefrontMediaEvidenceBackfiller` + `storefront-media:backfill-evidence {--tenant=} {--limit=200} {--dry-run}`:
- Targets active assets with ready variants and ready derivatives whose evidence is null; reads the widest served variants from R2 in both formats and unions the extremes (an asset is only as safe as its darkest/lightest served file).
- Tenant-scoped (tenant context set explicitly), bounded by `--limit`, idempotent, `--dry-run` writes nothing.
- Candidates are walked by an `id` cursor and `--limit` bounds what is *written*, so permanently unreadable rows never block later recoverable ones (Codex P2); failed rows are retried each run and counted.
- A file that cannot be read or decoded leaves evidence **null** and is reported as `failed` — it never produces optimistic evidence.

## Proof

| Gate | Result |
|---|---|
| `StorefrontMediaPixelEvidenceTest` | 10 — extrema exactness, alpha ⇒ unprovable, version/shape rejection, margin clamp, margin never narrowed by stored slack, real JPEG/WebP ringing within margin |
| `StorefrontMediaApiTest` / `StorefrontMediaDerivativeTest` | evidence stored on upload and on derivative render (`frame` / `transform`), absent from API responses |
| `StorefrontMediaEvidenceBackfillTest` | 3 — measures assets + derivatives and writes only null evidence; unreadable file stays null and is reported; command validates tenant and limit |
| Review fixes | palette-image test (fails without the fix) · stuck-prefix backfill test (limit=1) |
| All `StorefrontMedia*` tests | 127 passed |
| Full `php artisan test` | see PR (28 known container-only failures: Fuel* need bcmath, Resend mail transport, user-invitation mail views — none touched) |

## Design Quality Pass
No visible surface changes in this slice (no UI, rendering or contract change); nothing to evaluate at 390–1440 / AR–EN. The first visual proof of this evidence is V6b-5.

## Invariants
| Invariant | Status |
|---|---|
| Tenant isolation | Backfill sets tenant context per run; evidence lives on already-tenant-scoped rows |
| Media ownership / Draft–Published | Untouched |
| Backward compatibility | Additive; null evidence = unprovable, so nothing that renders today changes; no migration |
| API contract | Unchanged (`region_luminance` not exposed) |
| Commerce / accounting | Untouched |

## Limitations / next
- Nothing consumes the evidence yet — **V6b-2** adds `background.kind = media` + overlay to the three normalizers and the publish gate (missing/pending/failed/alpha evidence ⇒ `contrast_unprovable`).
- Whole-frame extrema are deliberately conservative; a tighter regional proof is a possible later refinement and would not change the stored shape's version contract (new `basis`).

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
