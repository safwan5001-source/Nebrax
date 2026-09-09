# AWJ Commerce — Workspace Model Open Decision

**Status:** OPEN / NOT DECIDED — research checkpoint only; not an implementation requirement.  
**Date:** 2026-09-10  
**Related:** `AWJ_COMMERCE_WEB_APP_EXPERIENCE_STRATEGY.md`, `AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md`

## 1. Decision to be made

AWJ has **not yet decided** the final information architecture or workspace model for Commerce / Web Store / Mobile App management.

The unresolved question is not merely whether Commerce should use a sidebar or horizontal navigation. The decision must first account for the fact that many capabilities needed by Commerce are already first-class AWJ capabilities.

## 2. Important constraint discovered during research

Commerce must not be designed as a second ERP inside AWJ.

The merchant already uses AWJ capabilities such as:

- Customers;
- Products;
- Inventory;
- Pricing and taxes;
- Invoices and sales documents;
- Payment methods and payment records;
- Shipping, pickup, delivery and fulfillment-related capabilities where provided by AWJ;
- Reports and analytics;
- other shared business capabilities.

Therefore, the presence of these concepts in an e-commerce workflow does **not** automatically justify creating duplicate Commerce navigation sections, duplicate master data, or parallel management systems.

## 3. Research direction — not yet approved as final IA

Before choosing the Commerce workspace navigation/layout, AWJ should perform a capability mapping that classifies relevant functions into three working categories:

### A. AWJ Core

Capabilities already owned and managed by AWJ Core. Commerce consumes or links to them rather than recreating them.

Examples may include Customers, Products, Inventory, Invoices, Payments and Reports. Exact ownership must be verified against the current AWJ architecture before implementation.

### B. Commerce-specific

Capabilities that exist specifically because AWJ supports Web/App/Commerce channels.

Candidate examples include:

- sales-channel configuration;
- Commerce listings / publication state;
- Web Store Builder;
- App Builder;
- storefront pages/content;
- channel presentation and theme configuration;
- domain / storefront SEO concerns;
- channel-specific visibility/content;
- preview/publish workflows;
- app build/release concerns where later approved.

These examples are research candidates, not a locked menu structure.

### C. Shared but Commerce-contextual

Capabilities whose authority remains in AWJ Core but may require a Commerce-specific view, workflow, filter, shortcut, or contextual entry point.

For example, Commerce may need a view of products published to a channel or orders originating from online channels without creating a second Product or Customer system.

## 4. Key UX question

The workspace design should answer:

> What genuinely belongs to Commerce, and what should Commerce simply surface from AWJ in the correct context?

Only after this mapping should AWJ decide whether the best experience is:

- a Commerce Hub;
- a dedicated Channel Workspace;
- a hybrid model;
- or another navigation/workspace structure discovered through research.

## 5. UI / UX direction while the decision remains open

The final workspace is expected to be a high-quality, visually refined, powerful and professional product experience.

**Ease of use must not be interpreted as reducing product capability.** AWJ may remain deep and feature-rich. The UX goal is to make that power organized, discoverable and efficient to operate rather than simplifying the product by removing advanced capabilities.

Likewise, the workspace should not duplicate AWJ Core merely to make Commerce appear self-contained.

## 6. Research references

Current research indicates useful patterns in systems such as Microsoft Dynamics 365 Commerce and Shopify, particularly the distinction between shared commerce/business capabilities and sales-channel-specific management. These references are inputs to research only; AWJ will not copy another product's IA wholesale.

## 7. Explicitly unresolved

The following are intentionally **not decided** at this checkpoint:

- whether Commerce has a dedicated full workspace or a lighter channel layer within AWJ;
- sidebar vs top navigation vs hybrid navigation;
- whether entering a channel replaces/supplements the main AWJ navigation;
- which AWJ Core capabilities receive Commerce-contextual views;
- which items appear as links/shortcuts versus dedicated Commerce screens;
- exact Commerce dashboard structure;
- exact Web Store workspace structure;
- exact Mobile App workspace structure;
- exact relationship between shared AWJ Reports and Commerce-specific analytics views;
- exact boundaries for shipping/fulfillment UI where AWJ Core already provides capabilities;
- final Design System V2 treatment for this workspace.

## 8. Gate before final workspace design

Do **not** lock the Commerce workspace IA from visual preference alone.

Before finalizing the workspace, perform a focused **AWJ Commerce Capability Mapping** against the actual current AWJ system and classify each capability as:

`AWJ Core` / `Commerce-specific` / `Shared but Commerce-contextual`.

Then use that map, together with UX research, to choose the workspace/navigation model.

---

**No implementation authorization:** This document preserves an unresolved product decision so the research is not lost. It does not authorize code changes, schema/API changes, accounting behavior changes, merge, deployment, or production release.
