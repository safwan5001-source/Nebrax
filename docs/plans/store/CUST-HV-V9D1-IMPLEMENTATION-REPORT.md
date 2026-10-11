# CUST-HV V9d-1 — Card tokens (global): alignment, picture shape / fit, hover — Implementation Report

## Identity

| | |
|---|---|
| **Horizon** | CUST-HV — Visual Design, Media & Merchant UX Completion |
| **Slice** | **V9d-1** — first of the V9d slices (card tokens global → per-section override → product / category section options → commerce-firewall closure). V9e product zoom follows. |
| **Branch** | `cust-hv/v9d1-card-tokens` (stacked on V9c-2 until it merges) |
| **Authority** | V0 §14.1 (card tokens) · §14.3 (commerce firewall) · §2.2 (additive, three normalizers in lock-step) · §5.2 (named steps, never a pixel input) · §6.6 (motion) |
| **Scope** | Document-level `cards` group in the global tokens (PHP authority + two byte-identical TS twins + the shared fixture), the stylesheet rules, stable hooks on the product and offer cards, the Canvas parity and the Theme panel group. No endpoint, schema or Publish-rule change; `PRESENTATION_CONFIG_VERSION` stays 3; no accounting effect. |

## AWJ Decisions recorded here

| Question | Decision | Why |
|---|---|---|
| Which V0 card tokens | `align` (`start` · `center`), `imageRatio` (`1:1` · `4:3` · `3:4`), `imageFit` (`cover` · `contain`), `hover` (`none` · `lift` · `zoom`). | The ones a card can honour without touching its data or risking a contrast verdict. |
| `density` | **Is the existing `productCard` control** (V0: "maps to `density`"); not duplicated. | One place per setting. |
| `radius` / `border` / `shadow` | **Are `surfaces`** (V5e-2a) globally and the section design's `radius` / `border` / `shadow` per section; not duplicated into `cards`. | Same reason; the Theme panel says where each lives. |
| `background`, `padding` | Not built: a card background needs a text-contrast gate over product copy; padding is density. | Never ship an unproven contrast surface. |
| `badgePosition` | Not built: any corner collides with the wishlist button (top-end) or the Market quick-view (bottom-start); it needs collision-free placement rules of its own. | Deferred, stated. |
| Defaults | A value equal to today (`start`, `cover`) is accepted and stored as written, and emits nothing; absence = today's card (start-aligned body, a height-sized cover image, a soft hover shadow and a 3 % image zoom). | Byte-identical for every existing store. |
| Hover semantics | `none` = no shadow, no lift, no zoom · `lift` = −4 px and the medium shadow · `zoom` = 1.06 image zoom, no shadow, no lift. Implemented with the individual `translate` / `scale` properties (what Tailwind's own `group-hover:scale-*` writes), so a token **replaces** the 3 % zoom instead of multiplying with it. Under `prefers-reduced-motion` nothing moves. | A bug the proof found: with `transform` the two zooms compounded. |
| Scope mechanism | Validated custom properties (`--cd-al`, `--cd-ir`, `--cd-if`, `--cd-hs`, `--cd-hl`, `--cd-hz`) + a token list in `data-gt` on the theme wrapper; the stylesheet keys off stable hooks (`data-card`, `data-card-image`, `data-card-body`, `data-card-price`). Custom properties inherit, so the per-section override of V9d-2 wins by proximity with no extra machinery. No string from the document reaches the DOM. | §3.5 / §5.2. |
| Cards covered | `ProductCard` and `OfferCard` (and the Canvas's product / offer cards). Category tiles keep their own markup (a separate, later look). | Smallest coherent set; stated. |

## What was built

- PHP `StorefrontGlobalTokensNormalizer` (`cards` after `surfaces`, canonical order `typography · buttons · surfaces · cards · layout · motion`); TS `global-tokens.ts` ×2 (`GlobalCards`, `normalizeGlobalTokens`, `resolveCardTokens`) and both `config.ts`; `global-tokens.json` fixture +11 cases.
- Stylesheet: the `cd-*` rules in `globals.css` and the mirrored `store-preview.css`; hooks on `ProductCard`, `OfferCard` and the Canvas cards.
- Theme panel: the **Cards** group (four selects, "as today" first, a note on what a card token can never do and where density / corners live); reset clears it.

## Backward compatibility

A document with no `cards` key resolves to nothing, so the wrapper and every card render exactly as before (test-pinned, and the real-Chromium base page measures today's heights 144 / 176 / 208 px, today's start alignment, today's shadow + 3 % zoom).

## Tests

- Shared fixture × PHP `StorefrontGlobalTokensTest`, storefront and web `global-tokens.test.ts` (74 / 69): canonical order, defaults accepted, unknown / wrong-case / injected values dropped, density / radius / border / shadow / background / padding / badge keys never survive in `cards`.
- Resolver tests (both apps): nothing for defaults, each token → closed variable + token, the three hovers, the ratios, and **no card key names a price, discount, stock, availability, offer or tax**.
- `GlobalTokensEditor` (cards write / remove / reset, Arabic copy), Canvas hooks (tokens reach the Canvas root; no card attribute without tokens).

## Design Quality Pass — real Chromium

`scripts/card-proof` renders the **production** `ProductCard` and `OfferCard` with the compiled storefront stylesheet inside a wrapper carrying what `resolveGlobalTokens` returns, for 10 variants (base · centre · three ratios · contain · three hovers · all) × AR RTL / EN LTR × 390 / 768 / 1280: **1 930 checks, 0 violations** — today's frame heights, start alignment and hover are unchanged; centred body and price row sit on the card's centre line; every frame (product **and** offer) has the exact ratio at every width; `contain` lays the whole picture in the frame; hover none / lift / zoom produce exactly the shadow, −4 px and 1.06 the contract says and **nothing moves under reduced motion**; no overflow, every card inside the viewport; and the **commerce check: every price, name, category, badge and availability string is identical to the base page in every variant**.

**Negative controls — each makes the proof fail:** `--noratio` (96 violations) · `--nohover` (24) · `--noalign` (48) · `--leak` (hide every price, 60).

Merchant app: `cust-hv-v9d1-card-tokens.spec.ts` — the real builder's Theme panel, AR RTL × EN LTR × 390 / 1024 / 1280 (6 / 6): the Cards group offers named steps only, writes the tokens (the Canvas root carries the token list and `--cd-*` variables), "as today" removes every trace, nothing overflows, every control inside the viewport.

## Limitations (stated)

- Category tiles and the per-section override are not part of this slice (V9d-2 adds `design.cards` for shelf sections; tiles keep their look).
- The Canvas's simplified product cards carry the hooks, so shape / fit / alignment / hover preview there; product data is live-API only, so the Theme-panel e2e proves the wrapper and the variables, and the real card visuals are proven on the production components.
- No `background`, `padding`, `badgePosition` or `reveal-cta` (reasons above).

## Invariants

Tenant isolation, authN/authZ, Draft vs Published, concurrency, media ownership: untouched. **Commerce firewall:** no card token carries a value, a string or a number into the card — the document accepts closed lists only, nothing reads prices or availability, and the browser proof asserts every commercial string is byte-identical across variants. No arbitrary CSS / JS / HTML. No journal entry, no accounting behaviour.

---

**Merge: PERFORMED only if and when all gates pass under Safwan's CUST-HV sequential-merge authorization (see PR). Deploy: NOT PERFORMED. Production release: NOT PERFORMED.**
