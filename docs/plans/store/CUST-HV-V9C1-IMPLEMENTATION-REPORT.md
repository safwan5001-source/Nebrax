# CUST-HV V9c-1 — Custom Content block vocabulary: model and storefront rendering — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V9c-1** — first of two V9c slices (**V9c-1 model + storefront** → V9c-2 Canvas + editor). V9a ✔ cover · V9b ✔ benefits · V9d cards / rails · V9e product zoom follow. |
| **Branch** | `cust-hv/v9c1-content-blocks` (stacked on V9b until it merges) |
| **Authority** | V0 §15 (shared block vocabulary, D-21) · §3.2 / §7 (`MediaRef`, per-locale alt, ownership) · §2.2 (additive, three normalizers in lock-step) · §3.5 (tokens only) |
| **Scope** | Content model (PHP authority + two byte-identical TS twins + one shared fixture) and the published rendering. No endpoint, schema or migration; `PRESENTATION_CONFIG_VERSION` stays 3; no accounting effect. The merchant editor and the Canvas still handle headings and paragraphs only (V9c-2); other kinds can arrive through the API and are drawn on the storefront. |

## The vocabulary (V0 §15)

`heading` (level 2 | 3, logical align) · `paragraph` (align, line breaks kept) · `image` (whole `MediaRef`, caption, link) · `button` (label, link, style `outline` | `link`) · `divider` (line | dots) · `spacer` (sm | md | lg) · `callout` (tone info | success | warning, registry icon) · `columns` (two columns of ≤ 4 leaf blocks; stacked below `md`). ≤ 12 top-level blocks.

## AWJ Decisions recorded here

| Question | Decision | Why |
|---|---|---|
| Existing documents | `heading` / `paragraph` without new fields normalise to the same `{ id, kind, text }`; the ceiling went **8 → 12**, so every stored document stays valid. Defaults (level 2, start alignment, line divider, `md` spacer, `info` tone, solid button) are the **absence** of the field. | Backward compatibility; equivalent documents literally equal (canonical-form rule). |
| Alignment / levels | Logical only (`center` / `end`), never left / right; headings are `h2` or `h3`, never `h1`. | RTL parity; one `h1` per page belongs to the hero. |
| Image | Keeps its whole `MediaRef` (alt per locale, decorative, framing, fit); drops whole without a usable one. Natural aspect (width / height attributes reserve space), lazy. Per-locale alt and ownership are the **generic media Publish gate's** — its scanner walks every `mediaId`, so images inside columns are covered by the existing path. | No new path; tenant isolation proven by test. |
| Button colour | **No `colour` yet**, and `soft` waits with it (without a colour `soft` equals `solid`). An explicit colour on an outline / link button needs a contrast gate against the section background (`CtaColourContrast`) — its own slice. A button without a colour follows the section colours already proven. | Never ship an unproven contrast surface. |
| Columns | Exactly two arrays (a missing one completes empty), ≤ 4 blocks each, no nesting, stacking below `md` is fixed in the renderer. | V0 §15. |
| Ids | Unique across the whole section (columns included); an invalid id becomes `block-{position}` (`col-{i}-{c}-{k}` in a column) so normalising twice gives the same text. | Idempotence. |
| Empty content | A text block with empty text is **kept** (the editor creates then types) and not drawn; an unresolved image, an incomplete button and an all-empty columns block are not drawn. | Same draft rule as CTAs. |
| FAQ accordion (Market) | Applies **only** when the section is nothing but headings and paragraphs (its original shape); any other kind switches to the general flow, so an image or button is never folded into a disclosure. | Backward compatibility without hiding new content. |
| Paragraph line breaks | Paragraphs now keep line breaks (`whitespace-pre-line`), as V0 §15 says ("plain; line breaks only"). | A visible but contract-mandated correction: before, an Enter in the editor collapsed. |
| Callout tone | Tone is an inline-start accent **and** a screen-reader label ("Note / Success / Warning", six locales) — never colour alone. Surface and text are the proven store tokens. | WCAG 1.4.1. |
| Text trimming | Heading / paragraph trimming and truncation now use the PHP rule (PHP `trim` set, code points) in the TS twin, instead of the JS `trim` / UTF-16 `slice` it had. | The PHP authority wins; only unusual whitespace or > 120 astral characters could differ. |

## What was built

- PHP `StorefrontContentBlocksNormalizer` (authority) wired into `StorefrontPresentationNormalizer` (`MAX_CUSTOM_BLOCKS` 12).
- TS twins `content-blocks.ts` (byte-identical, added to the twin-identity test) and `section-content.ts` ×2 (delegates; `CustomBlock = ContentBlock`).
- Storefront: `content-blocks-resolve.ts` (joins images to the server's resolved media by JSON path, top-level and nested), `CustomContentBand` (general path + the unchanged text-only path), `BannerCtaLink` exported for the button block, `home.content.{note,success,warning}` in six locales, `contentLabels` plumbing.
- Merchant app: only what keeps it compiling and safe — the Canvas draws the two original kinds; `CustomFields` edits them and **preserves any other block untouched**; the new-block id never collides.
- Proof tooling: `scripts/content-proof/measure.mjs` + env-gated `content-proof.render.test.tsx`.

## Tests

- Shared fixture `content-blocks.json` (47 cases, expected values computed by the PHP authority and reviewed line by line) × PHP `StorefrontContentBlocksTest`, storefront and web `content-blocks.test.ts` (96 each, incl. idempotence and key order).
- PHP integration with real uploads: per-locale alt required at the right path **inside a column too**, decorative accepted, **another tenant's picture is `media_missing`**, hidden section never blocks.
- Storefront: `content-blocks-resolve.test.ts` (6), `CustomContentBand.blocks.test.tsx` (11), existing FAQ tests unchanged and green.

## Design Quality Pass — real Chromium

`scripts/content-proof` renders the **production** `publishedNodes` → `resolveContentBlocks` → `CustomContentBand` with the compiled storefront stylesheet for four pages (mixed · columns · aligned · designed dark surface) × AR RTL / EN LTR × 390 / 430 / 768 / 1024 / 1280 / 1440: **904 checks, 0 violations** — no horizontal overflow; unbroken words wrap in every block; pictures decode, keep their natural ratio and never exceed their container; columns **stack below 768** (shared inline-start edge, DOM order) and sit **side by side from 768** (equal widths, first column on the inline-start edge); alignment is logical (start / centre / end flush to the right edges in both directions); spacers 16 / 32 / 56 px; line divider a 1 px rule, dots three; buttons ≥ 40 px and inside the page; callout text ≥ 4.5 : 1 on its own surface (designed or not), a 4 px inline-start accent, the tone present as text; paragraph line breaks kept.

**Negative controls — each makes the proof fail:** `--physical` (alignment as physical right, 24 violations) · `--nostack` (columns never side by side, 16) · `--widepics` (pictures lose their max width, 24).

## Limitations (stated)

- The editor and the Canvas know only headings and paragraphs until V9c-2; the other kinds are drawn by the storefront when they arrive through the API.
- No button colour / `soft` (gate first); one column count (two); no rich text, no embeds, no free positioning (by contract).
- The Canvas does not yet draw `level` / `align` of headings.

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: **untouched or strengthened** — images ride the generic media gate (tested in columns and across tenants); no URL, style or HTML enters the document (closed lists, plain text, links through the existing sanitiser, text rendered as text). Commerce firewall: nothing here touches price, offer, stock or tax. No journal entry, no accounting behaviour.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
