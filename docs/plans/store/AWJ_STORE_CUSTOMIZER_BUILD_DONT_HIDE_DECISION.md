# AWJ Store Customizer — Build, Don’t Hide Decision

**Status:** Owner-approved product/engineering direction  
**Scope:** AWJ Store Customizer / public storefront capabilities  
**Decision date:** 2026-09-25  
**Base main SHA when recorded:** `fcb0e20b2b5c4cad8df9469e18d6d0d23002e2c9`

## Decision

Merchant-facing Store Customizer capabilities must not be hidden merely because they are incomplete.

The product direction is:

> **Build the capability end-to-end instead of hiding it.**

A capability that is visible in the customizer and intended for AWJ Store should be completed honestly across its real lifecycle whenever it can be built safely within scope.

The target lifecycle is:

`Merchant edit → Draft → Save → Preview → Publish → Published Storefront`

A capability is not complete merely because a section type, editor panel, toggle, or preview shell exists.

## Priority capabilities

The next Store Customizer capability-completion horizon should prioritize the currently incomplete merchant-facing sections, including:

- Promotional banner / `banner`
- Featured products / `featured`
- Offers / `offers`
- Store benefits / `benefits`
- Store application promotion / `appPromo`
- Custom content / `customContent`

The evidence pass for that horizon must also inspect every other merchant-visible Store Customizer capability and must not assume this list is exhaustive.

## Per-instance content

For repeatable sections, each section instance must have its own durable content where the product model requires it.

The target is not only:

`{ id, type, visible }`

but a real content model that supports the section’s merchant-editable data and survives:

`Draft → Save → Preview → Publish → Published Runtime`

Do not simulate per-instance content only in editor state if the published storefront cannot consume it.

## Capability-specific direction

### Banner

Build a real banner capability with an evidence-backed content contract, persistence, preview, and published rendering.

Fields such as text, CTA, link, image, alignment, or presentation settings must only be added after verifying what belongs in the AWJ contract. Do not invent arbitrary fields without evidence.

### Featured products

Build real merchant product selection and ordering with persistence and published rendering.

Product identity, availability, price, stock, and other commerce facts remain server-owned. The customizer must reference products; it must not author financial truth.

### Offers

Build only on real AWJ commerce offer/discount authority.

Do not let the Store Customizer invent prices, discount percentages, totals, tax, or other monetary facts that are not backed by the authoritative commerce model.

If the current offer model is insufficient, produce a decision packet rather than creating a parallel pricing system.

### Benefits

Build editable benefit items with a safe structured contract, persistence, preview, and published rendering.

Use structured fields only. Preserve localization and RTL/LTR behavior.

### App promotion

Build the section only from real app metadata and real links.

Do not present an application, store badge, QR target, or availability state that does not actually exist.

### Custom content

Build custom content as structured, safe blocks.

Do **not** add arbitrary merchant HTML, CSS, JavaScript, iframe execution, or equivalent unsafe free-form runtime content.

## “Backend missing” is not an automatic deferral

The absence of a backend implementation is not, by itself, sufficient reason to defer a capability.

If the required backend, API, persistence, validation, and published runtime can be built safely within the horizon without crossing a material decision gate, build them.

A capability may remain blocked only when a real decision or authority boundary exists, for example:

- a material product/data-contract choice;
- a schema or migration choice with meaningful backward-compatibility risk;
- a tenant/security/auth/RBAC change;
- a financial, pricing, discount, payment, or tax authority decision;
- a storage-provider or media-architecture decision;
- another owner-controlled architectural gate.

When such a gate is reached, issue a Decision Packet and continue with independent work where possible.

## Merchant UX rule

Do not solve incompleteness by silently hiding intended AWJ capabilities.

While a capability is genuinely not yet available, the UI may communicate that state honestly during implementation, but the long-term target is to build the intended capability, not remove it from the product.

A merchant-facing control must never imply successful support when the published runtime cannot honor it.

## Preview and published parity

Every completed capability must be verified across both:

- Store Customizer Preview
- Published public storefront

Preview-only success is not completion.

The same merchant-authored state must resolve consistently after publish, subject only to intentional runtime safeguards and server-owned commerce facts.

## Visual and interaction quality

For each completed capability verify:

- Desktop and mobile
- Arabic RTL and English LTR
- Loading
- Empty
- Error
- Disabled/unavailable states where materially relevant
- Long content
- Missing optional media
- Safe fallback behavior
- Existing-theme compatibility

Target viewports should include:

`390, 430, 768, 1024, 1280, 1440`

## Safety invariants

All capability work must preserve:

- Tenant Isolation
- `commerce.manage` authorization
- Draft/Public separation
- server-owned price, totals, discounts, tax, stock, and availability
- backward compatibility for existing stores
- safe handling of unknown presentation values
- existing `presentation: null` fallback behavior
- no arbitrary merchant HTML/CSS/JS execution
- no accidental activation of unsupported commerce authority

Do not change accounting, invoicing, payment, tax, or posting semantics as a side effect of Store Customizer work.

## Horizon rule

The next capability-completion horizon must use the official:

`docs/autonomous-engineering/AWJ-HORIZON-SYSTEM.md`

and should:

1. start from the closure/evidence of the preceding Storefront Visual Completion Horizon;
2. avoid broad rediscovery already proven by durable docs;
3. classify merchant-visible capabilities from current code evidence;
4. automatically implement all dependency-ready capabilities that are safely buildable;
5. use small dependency-safe PRs;
6. run focused tests first, then broader risk-based validation;
7. verify exact final heads before merge;
8. merge only after the Horizon pre-merge gate passes;
9. continue automatically to the next ready capability;
10. stop only at a real decision gate or horizon end.

## Merge and release authority

In-scope PRs for an explicitly authorized Horizon may follow the Horizon merge cycle after all required quality gates pass.

This decision does **not** authorize:

- Production deploy
- Production release
- Production migration
- App Store / Google Play release
- Destructive production action

Those still require explicit owner approval.

## Definition of completion for the next horizon

The capability-completion horizon should not close merely because unsupported controls were hidden or relabeled.

It should close only when:

- every merchant-visible capability in scope is classified from current code evidence;
- every safely buildable capability in scope is implemented end-to-end;
- relevant per-instance content is durable;
- Preview and Published Runtime parity is proven;
- mobile/desktop and RTL/LTR are verified;
- no P1/P2 finding remains open;
- remaining blockers are genuine decision gates, backend authorities outside scope, or explicit owner deferrals;
- a durable closure report records what became live, what remains gated, and why.

## Summary

**AWJ product direction: build intended Store Customizer capabilities; do not hide them as a substitute for implementation.**

The Store Customizer should become a real merchant authoring system whose visible capabilities work honestly from authoring through the published storefront.
