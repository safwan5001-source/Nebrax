# CUST-HV V4a — `MediaRef` contract, branding media references, public resolution & rendering — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V4a** — first half of V4 (V4b = the merchant MediaPicker / Image Editor UI and logo-migration UX) |
| **Branch** | `cust-hv/v4a-mediaref-contract` |
| **PR** | see PR description (opened with this report) |
| **Base SHA** | `2c8fdbb8` — `origin/main` after V2c (#1263) merged |
| **Authority** | V0 §3.2 (`MediaRef`, AMEND-10/14), §7.5–§7.8, §1 DEF-5; Master Execution §6 (V4) |
| **Depends on** | V2 (V2a #1255, V2b #1262, V2c #1263) |

**Why V4 is split.** V4 as written is a document contract ×3, a public resolution path, storefront rendering, *and* a picker + editor + states UI. The first three are independently mergeable and are what V4b (and V5/V6/V7/V8/V9, which all hold `MediaRef`s) build on, so they ship first, **behind the same flag** (`STOREFRONT_MEDIA_R2_ENABLED`, off): until V4b exists no merchant can create a `MediaRef`, and every existing document renders byte-for-byte as before.

---

## Implemented

### 1. `MediaRef` — one contract, three implementations, one fixture
`{ mediaId, fit?, focal?, crop?, rotate?, alt?{ar,en}, decorative? }` — a reference to a library asset plus its framing **on this usage**. Never a URL, path, size or luminance in the document (V0 §7.8).

| Rule | |
|---|---|
| Lenient + deterministic | A Draft is never rejected: a bad field is dropped on its own (a broken `crop` keeps a valid `rotate`), a bad id drops the whole ref. |
| Defaults never stored | `fit: cover`, centred focal (50/50), `rotate: 0`, `zoom: 1` are omitted, so equivalent documents are equal. Fixed key order. |
| Allow-list | `url`, `src`, `path`, `width`, `height`, `avg_luminance`, `style`… never survive. |
| Alt | per locale, trimmed, control characters flattened, ≤ 150 code points; never cross-substituted; `decorative` only as a real boolean. |
| Crop identity | validated through the same `StorefrontMediaTransform` that derives V2b's `transformKey` — so what the document stores is exactly what the derivative pipeline hashes (zoom included). |

PHP `StorefrontMediaRefNormalizer` (authority) · `web/.../presentation/media-ref.ts` · `storefront/src/lib/presentation/media-ref.ts` (byte-identical twins) · fixture `tests/Fixtures/presentation/media-ref.json` (32 cases, run by all three).

### 2. Logos & favicon → media references (fixes **DEF-5**)
Additive optional keys `branding.logoMedia`, `compactLogoMedia`, `faviconMedia`, emitted only when valid; `PRESENTATION_CONFIG_VERSION` stays 3. **The legacy `*DataUrl` fields are untouched and render forever**; when both exist the reference wins. Migration is **lazy on the next save** (V4b), never a bulk rewrite — so the three-max-logos-exceed-1.5 MiB problem disappears as merchants adopt references, with no forced change for anyone.

### 3. Public resolution — `data.presentation_media`
`StorefrontPublishedMediaResolver` joins every published `MediaRef` with the library and returns, **keyed by the reference's JSON path** (`branding.logoMedia`), `{width, height, decorative, alt{ar,en}, sources[{kind,width,height,format,src}]}`:
- `src` is the **same-origin proxy path only** (`/api/storefront/media/customizer/{id|transformKey}/{file}`); never the raw origin path, a storage key, a hash or the original file name (asserted over the whole response).
- a no-transform usage → the base ladder (+ thumbnails); a transformed usage → **its own derivative rows at their real rendered sizes** (widths clamped to the frame collapse to one entry) — all keys computed server-side, so there is no TS twin of the key hash to drift;
- alt: usage override per locale, else the library default for **that** locale;
- anything unresolvable (asset deleted/not ready/another tenant's, derivative missing) is **omitted, never guessed**; a document with no `mediaId` costs zero queries and yields `{}`.

### 4. Storefront rendering
- `readResolvedMedia` — defensive read: accepts only the proxy form (re-derived from the contract, so traversal, absolute URLs, `//host`, query strings, raw origin paths, `javascript:`/`data:` are all dropped); a bad source never poisons its siblings.
- `MediaImage` — `<picture>` with a WebP `<source>` and a JPEG `<img>` fallback as **separate explicit URLs** (no `Accept` negotiation), `srcset` from real widths (thumbnails never enter it), `width`/`height` always (no CLS), alt per locale with `alt=""` for decorative (present, never omitted), the usage's own `object-fit` / `object-position`, lazy by default.
- Header/footer `StoreBrand` render the media logo (eager — it is above the fold), falling back to the legacy logo, then the wordmark; `/icon` redirects to the same-origin 320 px thumbnail (WebP first), with the logo reference as a fallback and the legacy favicon as a final fallback.

---

## Design Quality Pass (storefront surface)
Brand stays above the fold and shift-free (explicit dimensions, eager); AR RTL / EN LTR alt resolved per locale; the typographic wordmark remains the honest fallback at every failure; no new visual chrome. The builder surface (picker, editor, states, six-width AR/EN evidence) is **V4b** — this slice adds no merchant-visible UI.

## Invariants
| Invariant | Status |
|---|---|
| Tenant Isolation | Resolution runs under the request's resolved tenant (`TenantContext`); a published document that names another tenant's asset resolves to nothing (tested). |
| Auth / RBAC | No new route; `/store/v1/storefront` stays the anonymous host-resolved read. |
| Draft vs Published | Only the **published** snapshot is resolved; drafts never reach the public payload. |
| Revision / concurrency | Untouched. |
| Media ownership | Public bytes still flow only through V2c's gate (published-reference + uniform 404); this slice only *names* them. |
| Commerce / accounting | Untouched. No journal entries. |
| Backward compatibility | Optional additive keys; legacy logos unchanged; `presentation_media` is an extra sibling (`{}` when empty); `AwjStorefrontConfig.presentationMedia` is optional so existing callers/tests are unaffected. |
| Accessibility | Alt per locale; decorative → `alt=""`; no motion. |

## Verification
| Gate | Result |
|---|---|
| Backend | `StorefrontMediaRefTest` **7** (fixture parity + idempotence + key order; additive branding; public config sources/alt/no-leak; derivative sources at real sizes; unresolvable omitted; zero-query for media-less documents; path keying) + presentation/identity/runtime suites = 20 passed |
| Storefront | resolved-media **7** · `MediaImage` **5** · `StoreBrand` **+3** · icon route **+4** · fixture parity (web + storefront) · biome ✓ · tsc ✓ · full vitest ✓ |
| Web | fixture parity (34) ✓; typed branding keys on the web twin |
| Full backend (sqlite, local) | 5735 passed · 57 skipped · **28 failed — all environment-only and identical to `main`** (`ext-bcmath` absent: Fuel* suites; mail view not compiled: `ResendMailTransportTest`, `UserInvitationTest`); none touches this slice · PostgreSQL by CI |

## Risks / deferred
- **No merchant can create a `MediaRef` yet** — V4b ships the picker/editor/logo UX; until then this slice is inert in Production by construction.
- Responsive `sizes` for the logo are fixed (112/144 px) — V5/V6 pass real layout hints for section media.
- `region_luminance` / contrast evidence on resolved media remains owned by V5/V6 (AMEND-20).

## Next dependency-safe slice
**V4b** — web MediaPicker (upload/select/reuse, processing/failed/Retry, per-usage readiness against the V2b API), bounded image editor (crop/focal/fit/rotate/zoom/reset, approved aspect presets), decorative toggle + per-usage AR/EN alt with resolved-fallback preview, Canvas preview through signed workspace URLs, logo/compact/favicon migration UX (lazy on save), six widths × AR/EN evidence.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
