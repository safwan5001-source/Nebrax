# STORE-BRAND-CLOSE-1 — Closure Report

**Horizon:** AWJ Store Official Brand, Contact & Payment Marks V1  
**Date:** 2026-09-27  
**Status:** FOLLOWUP_IN_REVIEW  
**Closure branch:** `docs/store-brand-close-1`

## 1. Closure decision

All implementation-ready non-payment work in this horizon is merged. The payment-logo implementation remains intentionally deferred because AWJ does not yet have an authoritative supported+enabled card/wallet capability source for the storefront.

No payment marks were added decoratively.

## 2. Final task state

| Task | Final state | Evidence |
|---|---|---|
| STORE-BRAND-0 | done | Evidence matrix created |
| STORE-BRAND-SOCIAL-ASSET-EVIDENCE-1 | done | First-party asset registry recorded |
| STORE-BRAND-WA-SOCIAL-1 | done | PR #1064, merge `4739ecd6928c0ad506824e9a57939b3f35b08439` |
| STORE-BRAND-APPS-1 | done | PR #1066, merge `316005750560add32b26dc5adad024efd5541ad9` |
| STORE-BRAND-CONTACT-1 | done | PR #1068, merge `5802fc30b673e1be8b7fff8943d733d55b5df7a0` |
| STORE-BRAND-PAY-EVIDENCE-1 | done_decision_gate | COD / pay_on_pickup only proven; card/wallet acceptance source absent |
| STORE-BRAND-PAY-1 | deferred | Waits for authoritative supported+enabled capability |
| STORE-BRAND-COMPOSE-1 | done | PR #1070, merge `6ad8195a70a75610dd950c32e0a28b193e9a0a65` |
| STORE-BRAND-QA-1 | followup_in_review | Baseline #1072/#1073 merged; close-review P2 follow-up in progress |
| QA trigger P2 follow-up | done | PR #1073, merge `b51f76f31967faf46281573b372ca362696c297e` |
| STORE-BRAND-CLOSE-1 | followup_in_review | Final closure waits for QA follow-up |

## 3. QA evidence

The browser QA matrix covers:

- 390 / 430 / 768 / 1024 / 1280 / 1440 widths;
- Arabic RTL and English LTR;
- merchant customizer preview;
- published Footer fixture using the real published Footer/AppPromo/WhatsApp components and public presentation helpers;
- horizontal overflow;
- responsive Footer composition;
- contact icons;
- official social marks;
- WhatsApp;
- App Store / Google Play badges;
- unsafe external values failing closed;
- screenshot artifacts.

PR #1072 passed its PR-head Web CI, Storefront CI, Core CI, and Store Brand QA checks before merge.

A review P2 then identified that the new visual QA workflow could be skipped by later implementation changes. PR #1073 expanded the workflow triggers to the implementation paths protected by the suite, including the AppPromo home component. Its Store Brand QA and Core CI checks passed before merge, and the review thread is resolved.

## 4. Published-route limitation

The QA fixture mounts the real published components and public presentation helpers, but it is not itself the tenant production URL. The earlier evidence explicitly distinguishes this from a fully populated production-route proof.

No claim is made here that a live production tenant with populated brand configuration was browser-verified during CLOSE-1.

## 5. External asset provenance

First-party/official asset provenance remains durable in:

- `docs/plans/store/AWJ_STORE_BRAND_SOCIAL_ASSET_REGISTRY.md`
- `docs/plans/store/AWJ_STORE_BRAND_ASSETS_EVIDENCE.md`

No unofficial social substitute is authorized by this closure.

## 6. Payment decision

The payment evidence decision remains explicit:

- proven Payment Intent methods: `cod`, `pay_on_pickup`;
- mada / Visa / Mastercard / Apple Pay / Google Pay are not yet proven storefront supported+enabled capabilities;
- therefore `STORE-BRAND-PAY-1` remains **deferred**;
- payment marks must not be rendered until an authoritative supported+enabled capability exists.

This deferral is a resolved state for this horizon, not an unresolved blocker.

## 7. P1 / P2 status

No unresolved P1/P2 remains in the STORE-BRAND scope at close-review time.

The QA-trigger P2 discovered after PR #1072 was fixed in PR #1073 and its review thread is resolved.

## 8. Deployment state

Deployment is reported conservatively:

- STORE-BRAND-WA-SOCIAL-1: recorded production auto-deploy success.
- STORE-BRAND-APPS-1: recorded production auto-deploy success.
- STORE-BRAND-CONTACT-1: no manual deploy was performed in that task.
- STORE-BRAND-COMPOSE-1: no manual deploy was performed in this session.
- STORE-BRAND-QA-1 and PR #1073 are test/workflow changes and had no manual deploy.
- CLOSE-1 does **not** independently claim production deployment verification for the later COMPOSE/QA slices where such evidence was not observed.

## 9. Safety / architecture impact

No CLOSE-1 change modifies:

- accounting rules;
- database schema;
- tenant isolation;
- RBAC;
- public API behavior;
- checkout/payment settlement behavior.

## 10. Horizon end

If this close PR is reviewed and merged, mark STORE-BRAND-CLOSE-1 as `done` and the horizon as **CLOSED**.

Per the task queue: **no automatic next horizon**.
