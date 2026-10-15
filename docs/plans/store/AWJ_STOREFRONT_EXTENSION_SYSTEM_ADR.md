# AWJ Storefront Extension System — Architecture Decision Record (Proposal)

**Date:** 2026-10-15  
**Status:** PROPOSED — documented for review; not authorized for implementation  
**Scope:** Native AWJ Store storefront presentation, sections, motion, and developer extensibility  
**Reference:** [AWJ Store Master Plan](AWJ_STORE_MASTER_PLAN.md), [Commerce Admin v3](../../../design-system/v3/COMMERCE_ADMIN.md), [Storefront Boundary v3](../../../design-system/v3/STOREFRONT_BOUNDARY.md)

## 1. Context and verified baseline

AWJ has a separate `storefront/` application (Next.js 16) and `web/` Commerce Admin / Studio (Next.js 15). Store presentation already supports merchant theme tokens, a scoped preview, published presentation versions, and a live Hero renderer at `storefront/src/components/home/HeroSection.tsx`. Existing Hero supports copy, CTAs and a backdrop, with an established publication/contrast validation path. This ADR **extends**, rather than replaces, Store Experience Builder.

The merchant storefront is brand-driven and separate from AWJ Admin. Tokens `--store-*` belong to storefront and canvas; administration chrome must not inherit them. Existing protections, publish validation, tenancy, and versioning remain authoritative.

**Problem:** merchants need cinematic animated Hero sections (entrance, reveal, parallax and scroll-driven interactions) and eventually reusable developer-authored sections without giving untrusted code execution access to the host storefront, checkout, customer data, or ERP.

## 2. Proposed decision

Adopt a **three-tier customization model**:

1. **Trusted visual presets (first release):** curated, audited React/CSS/GSAP motion templates, configured through validated JSON; no merchant-provided executable code. Motion presets are optional and default safely for existing documents.
2. **Constrained markup/style (later, separate approval):** allow an explicitly specified subset of HTML/CSS, sanitization + CSS scoping and policy validation. No script tags, event attributes, external CSS imports, dangerous URLs or unrestricted style injection. A sanitizer is defense-in-depth, not a JavaScript sandbox.
3. **Developer extension packages (later, separate security architecture approval):** versioned, reviewed bundles with JS/React/GSAP/Three.js as required; untrusted packages execute in a strongly isolated sandbox, **not in the storefront origin**. Build and package scanning alone do not make code trustworthy. A vetted native plugin is a distinct, higher-trust distribution path requiring code review and release controls.

The visual builder does not promise arbitrary Webflow-style DOM editing in V1. Developer isolation, developer API, package registry, and marketplace are **future proposals**, not current capabilities.

## 3. Trust boundaries and execution policy

- **Host page / checkout / ERP:** no execution of untrusted merchant JS in the host document, shared origin, or Commerce Admin. No direct DB, secrets, admin session, commerce mutation API, browser storage, or checkout DOM access.
- **Sandbox:** dedicated *separate-origin* host (separate registrable site where feasible), restricted sandboxed iframe, strict CSP, limited permissions policy, and no implicit credential/cookie sharing. Never rely on sandbox flags alone. Avoid same-origin combination of `allow-scripts` and `allow-same-origin`; use independent-origin containment and threat-model each permission.
- **Bridge:** minimal versioned, origin-checked, schema-validated `postMessage` protocol; explicit capabilities (e.g., public catalog read, navigation intent), rate/size limits, and no broad proxy or arbitrary fetch. The host remains authoritative for navigation, cart, checkout and pricing.
- **Network:** CSP, connect allowlists, and server-side egress controls for build services. Third-party dependencies reviewed and pinned; no tokens supplied to client bundles.
- **Assets / storage:** tenant/store-scoped access rules; upload media ownership checks; public assets separated from sensitive data; audit publishing and rollback actions.
- **Availability:** timeouts, resource budgets and graceful static fallback if sandbox or animation cannot load. A CSP/iframe boundary mitigates risk but does not guarantee complete isolation against all browser threats.
- **No arbitrary merchant JS in published host HTML**, even when entered through an HTML editor.

## 4. V1: Animated Hero Builder — proposed contract

Use existing presentation-section architecture and lifecycle rather than adding parallel store or page tables. This is a *candidate contract*; exact naming/location must be aligned with the authoritative PHP normalizer and both TypeScript twins before approval:

```json
{
  "type": "hero",
  "animation": {
    "preset": "reveal",
    "intensity": "subtle",
    "durationMs": 650,
    "desktop": true,
    "mobile": "reduced"
  }
}
```

Candidate allowlisted presets: `none`, `fade`, `reveal`, `parallax`, `scroll-progress`. No arbitrary expressions, JS, selectors, custom GSAP timelines, or URLs. Unknown and invalid values must be rejected or normalized consistently across server and frontends; **define backward-compatibility policy explicitly** before implementation.

V1 editor: template picker, preview play/replay, intensity/duration within hard caps, mobile reduced/default state, draft save, publish validation and rollback. Animation does not intercept shopping actions or demand scroll to reach CTA. Shared client UI may implement animations, but the published store remains SSR-friendly and functional with JavaScript disabled.

## 5. Interaction, performance, accessibility and SEO gates

- Respect `prefers-reduced-motion` with a genuine static/low-motion equivalent; avoid automatic motion that obscures content.
- Use transforms/opacity where practical; prevent layout shifts and content overlap. Responsive RTL/LTR behavior and touch/keyboard interactions are mandatory.
- Keep CTA, product names and critical information in semantic, indexable HTML rather than animation canvas/video alone.
- Images/video must use responsive sources, defined dimensions and explicit loading priorities. Do not use heavy WebGL/Three.js for ordinary transitions.
- Set measurable budgets during the first implementation slice for mobile bundle size, INP, LCP, CLS, long tasks and low-end-device behavior; no speculative numeric threshold is asserted by this ADR.
- When client JS fails or is disabled, render legible static Hero with working normal links.

## 6. Isolation / lifecycle / compatibility invariants

- Tenant isolation includes stored presentation, asset ownership, previews, extension packages, domain bindings and publish actions. Cross-store referencing fails closed.
- Existing draft/scheduled/published lifecycle, access controls, publication gates and rollback semantics remain intact.
- No breaking API changes or migration without separate scope and approval. Old Hero documents must render unchanged when no animation is configured.
- No changes to orders, payments, invoicing, inventory reservation, ZATCA, or accounting.
- Preview must closely match published output; no CSS token leakage between AWJ Admin and merchant themes.
- Treat sections as presentation only; product prices, stock and checkout remain authoritative on existing commerce services.

## 7. Phased implementation and acceptance gates

| Phase | Deliverable | Acceptance evidence |
|---|---|---|
| **0 — reconnaissance** | Identify current authoritative schema, normalizer, publish gate, dual TS copies, Canvas renderer, and Hero tests; agree motion config contract | Dependency map + no speculative changes |
| **1 — native motion presets** | Add optional validated `animation` config, trusted renderer, editor controls, preview, fallback | Server/TS parity fixtures, old-doc snapshots, RTL/LTR, mobile, reduced motion, SSR/no-JS, tenant access, performance tests |
| **2 — constrained HTML/CSS** | Define sanitizer, CSS isolation, URL/content rules, threat tests | XSS/CSS escape regression tests and approval before any rollout |
| **3 — SDK / isolated runtime** | Developer package contract, sandbox origin, CSP, capability bridge, release process | Explicit threat model, browser adversarial tests, auth/tenancy tests, resource limits, security review |
| **4 — curated marketplace** | Vetting, permissions, version pinning, revocation, rollback | Supply-chain and incident-response controls |

**Phase 1 is the only recommended near-term implementation candidate.** Each phase needs its own scope and explicit approval; approval of this ADR does not authorize code changes.

## 8. Open decisions before implementation

1. Exact schema shape and PHP/TS normalization of animation options.
2. Which Hero variants and theme presets support each animation, and static fallback for unsupported variants.
3. Whether motion assets and timelines are shipped eagerly or lazy-loaded; mobile budgets.
4. iframe preview versus existing scoped preview for advanced motion parity.
5. For future extensions: isolated origin topology, CSP and bridge contract, package review owner, supported libraries and licensing.
6. Whether developer-built *trusted native* templates require separate marketplace certification.

## 9. Explicit non-goals / authority

This documentation is not a request to merge, deploy, publish to production or change any financial/security business logic. No merchant JavaScript editor or executable extension system is implemented by writing this ADR. Production changes, migration, deployment and final trust architecture require explicit approval.

**Recommendation:** implement curated animated Hero presets first through current Studio and storefront, preserving all existing boundaries.