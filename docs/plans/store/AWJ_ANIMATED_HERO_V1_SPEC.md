# AWJ Animated Hero Builder V1 — Implementation Contract (Draft)

**Date:** 2026-10-15  
**Status:** REVIEW-READY PROPOSAL — not implementation approval  
**Parent ADR:** [AWJ Storefront Extension System](AWJ_STOREFRONT_EXTENSION_SYSTEM_ADR.md)  
**Scope:** trusted motion presets for existing Hero sections in Studio and published storefront. No merchant JS runtime, no new checkout/ERP behavior.

## A. Verified architectural constraints
- Use the existing section/presentation model, authoring Studio, server-side publish validation, scoped preview and separate Next.js storefront. Do not introduce parallel homepage records.
- Review authoritative PHP normalization/publish validation and the corresponding TypeScript copies before code edits; preserve existing section-content schema and its fixture parity.
- Current published Hero renderer: `storefront/src/components/home/HeroSection.tsx`. Preserve headings, buttons, fallback semantics, safe destinations, backdrop and contrast checks.
- Storefront style tokens are merchant-owned (`--store-*`); editor chrome remains AWJ-owned.
- Publication permissions, revisions and tenant/store ownership remain governed by the current services.

## B. Candidate contract — to be confirmed against authoritative schema in Phase 0
The following is **not** a deployed schema. Exact nesting must follow existing section normalization.

```json
{
  "type": "hero",
  "animation": {
    "preset": "reveal",
    "intensity": "subtle",
    "durationMs": 650,
    "mobile": "reduced"
  }
}
```

Fields and acceptance rules (candidate):
| Key | Type | Accepted values | Default / boundary |
|---|---|---|---|
| `preset` | enum | `none`, `fade`, `reveal`, `parallax`, `scroll-progress` | `none` when field absent |
| `intensity` | enum | `subtle`, `standard` | `subtle` |
| `durationMs` | integer | 200–1200 inclusive | 650 |
| `mobile` | enum | `off`, `reduced`, `on` | `reduced` |

**No arbitrary selectors, inline script/JS, animation keyframes from tenants, custom timelines or network origins.** Do not add the earlier speculative `desktop` boolean until its semantics are established. On unspecified/old documents, motion is OFF: exact legacy static render; existing docs are not rewritten or republished. For malformed *authored* values, recommendation is server 422 at the precise field path on publish with matching editor feedback; maintain draft recovery behavior and never break old documents. Final normalization policy requires proof against current PHP/TS contracts.

Motion setup is an enhancement: the initial SSR markup and content must remain visible if JS fails, and no-JS view preserves CTA clickability. Client hydration must not briefly hide content; start motion only after hydration/visibility detection and avoid flash/jump.

## C. Presets, motion behavior and preview parity

| Preset | Desktop published | Mobile behavior | Reduced-motion behavior |
|---|---|---|---|
| none | static | static | static |
| fade | opacity entry only | short opacity if mobile on; static if reduced/off | static |
| reveal | text/image entrance using opacity + transform | smaller travel if mobile on; static if reduced/off | static |
| parallax | subtle independent background/content movement | reduced travel when on; static when reduced/off | static |
| scroll-progress | section-local scroll progress, no global scroll hijacking/pin | low-intensity when on; static when reduced/off | static |

Editor preview and published render MUST share motion interpretation/preset logic rather than duplicate algorithmic implementations drifting apart. Different runtime bundles may use parity fixtures and screenshot/browser proof where shared code is impractical. Preview controls: play/replay, device switch, reduced-motion simulator, save as draft, publish via existing gate. Scroll presets should be testable within the preview viewport without scrolling the administration shell.

Unsupported hero layout, absent image, low-power constraints, media errors, or JS failure degrade to readable static layout; do not add fake products/imagery. One primary `h1` stays as is. CTAs remain operable at all animation states.

## D. Performance and accessibility release gates

**Targets below are proposed release gates, not claims about existing metrics; collect a reproducible baseline before implementation.**
1. Test at 390px and 360px mobile plus desktop 1440px, both RTL and LTR, with CPU throttling, reduced-motion on/off, and at least one low-end handset/emulation profile.
2. No new CLS attributable to Hero animation (reserved media dimensions, no geometry reflow); Lighthouse/Web Vitals regression compared to the untouched baseline must be documented. Use standard CWV thresholds as review references: LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 at p75 where field data exists; lab results are not field proof.
3. Agree a **bundle delta cap** from measured baseline before selecting GSAP/animation library. Motion assets should load only when a section opts in, without loading Three.js in V1. Track KB compressed and JS main-thread time.
4. Avoid long tasks and animation-frame work proportional to the full page; use requestAnimationFrame/visibility and cleanup on route/section change. No unbounded observers/listeners.
5. Honor `prefers-reduced-motion` regardless of tenant settings. Keyboard focus, CTA navigation, contrast, readable page copy and screen-reader order unchanged.
6. Respect semantic SSR, image loading priority for LCP, lazy loading of noncritical images, media failure fallback and RTL directionality. Avoid scroll hijacking and forced autoplay media.

## E. Security and correctness acceptance matrix

| Area | Required test/evidence |
|---|---|
| Normalization | PHP authoritative + TS twin parity for allowed, absent, unknown, invalid types, min/max, malformed inputs |
| Backward compatibility | Existing presentation fixtures and old Hero output unchanged if `animation` absent |
| Tenant isolation | Cross-tenant/store media or presentation IDs rejected, store-scoped preview/publication permissions unchanged |
| Publishing | Validation errors precise, draft retains editability; scheduled/published state unchanged |
| Rendering | SSR/no JS static, hydrated and reduced-motion; functional CTA; one H1; backdrop and button contrast gates |
| UI | Preview/published browser screenshots and deterministic motion-state assertions, mobile RTL/LTR, theme variations |
| Performance | Measured baseline/delta, no animation-induced CLS, interaction remains usable |
| Scope | No direct changes to cart, checkout, payment, stock, accounting, invoices or ZATCA |

## F. Delivery slices (each with separate approval)

- **V1-0 Discovery contract lock:** locate existing normalizers, section schema, dual TypeScript contracts, published Hero, editor canvas, fixtures and test commands. Submit file map + exact proposed schema + baseline. No code changes.
- **V1-1 Contract and validation:** additive optional config with PHP/TS parity tests, old-document fixtures, publish validation, tenancy/auth regression.
- **V1-2 Trusted renderer:** presets and static fallback in storefront, no-JS and reduced-motion browser tests, bundle/perf gate.
- **V1-3 Studio controls:** editor field UI, live device preview/replay, matching validation and parity proof; full publish/draft/rollback regression.
- **V1-4 Closure:** integrate evidence, performance comparison, risk report and recommendation for approval. No automatic merge/deploy.

For implementation reports request: changed files, tests and results, build/CI, risks, remaining work, branch/PR/base/head SHA, next action. No merge, deploy or production release without explicit approval.

## G. Security of future extensibility — separate track, not V1

Future HTML/CSS and developer JS packages require a standalone threat model before implementation: attacker capabilities, sandbox origin topology and cookie boundaries, CSP/Permissions Policy, bridge message authentication/validation, public-data capabilities, build egress, dependency pinning, package revocation and incident response. **The V1 trusted preset renderer does not accept merchant JS.** A marketplace is not a dependency for V1.

## H. Unresolved until discovery (explicit blockers to code, not blockers to drafting)
1. Exact schema placement relative to current `homepage.sections[*]` and existing Hero content/design contract.
2. Exact baseline & final performance budget after measuring current storefront.
3. Whether existing Canvas runtime supports identical animations or requires isolated preview parity infrastructure.
4. Current publish gate's 422 field-path conventions and invalid draft behavior.
5. Which layout variants and media backgrounds have deterministic parallax semantics.

**Recommendation:** authorize only V1-0 discovery next; decide schema and measurable budgets from its evidence before implementation.
