# CUST-H3-2 — Evidence / Decision Report

## Status

**CUST-H3-2 DECISION READY FOR OWNER REVIEW.**

No implementation, merge, deploy or Production release is authorized by this report.

## Baseline

`2981743de0bea007ca1f3941bc0f2cbf9840b23d`

## Current AWJ findings

- `primaryColor` is a real semantic runtime value.
- `accentColor` persists but has no public semantic consumer.
- `fontPreset` is a closed enum with only `cairo-geist`.
- the merchant font select is disabled because there is no second valid choice.
- storefront runtime already uses `next/font/google` for Cairo + Geist.
- Canvas currently hard-codes Cairo/Geist instead of consuming `fontPreset`.

## Decisions

- Keep `primaryColor` LIVE.
- Keep `accentColor` persisted but GATED/hidden.
- Keep one merchant-facing Typography control.
- Preserve `cairo-geist` as default.
- Attempt exactly one curated alternative in H3-2: `tajawal-geist`.
- Tajawal activation is conditional on local import/build/runtime verification.
- No custom font upload.
- No separate body/heading fields.
- No DB/API change.

## External evidence

- Shopify: global color/typography settings apply store-wide; reusable palette/scheme model supports consistent semantics.
- Next.js: `next/font` self-hosts/optimizes fonts and avoids browser requests to Google.
- Tajawal: open-source Arabic family with seven weights and web suitability.
- IBM Plex Sans Arabic: reviewed as a valid future option, intentionally deferred to avoid expanding this slice.

## Next step after owner merge

Execute **CUST-H3-2 implementation** with Claude Code from latest `origin/main`, following the implementation contract in this PR.
