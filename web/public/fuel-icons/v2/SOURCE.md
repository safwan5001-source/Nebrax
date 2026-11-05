# AWJ Fuel Icons V2 — Reference-Locked Edition (vendored, do not edit)

- `png/` and `svg/`: **verbatim** from `AWJ_Fuel_Icons_V2_Light_Dark.zip` (checksums in `checksums.json`, enforced by a unit test).
- `icons.json`: verbatim upstream manifest (labels are kept separate from artwork).
- `sm/`: **derived** 128×102 LANCZOS downscales of `png/` (same artwork, only resampled) for sizes ≤ 64px; reproducible, not an
  edit of the design. Used through `srcSet` by `src/lib/fuel-icons/fuel-icon.tsx`.
- Upstream limitation: the SVGs are raster-backed wrappers (base64 PNG), not vector paths; they are shipped for completeness, the
  components use the PNG/`sm` files (no 33% base64 overhead). The artwork is never recolored; dark themes use a light plate behind it.
