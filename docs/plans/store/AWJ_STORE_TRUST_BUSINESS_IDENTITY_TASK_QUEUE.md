# AWJ Store Trust, Business Identity & External Brands — Task Queue V1

**Horizon:** AWJ Store Trust, Business Identity & External Brands V1  
**Base at horizon definition:** `7c1dd55c7e7cd2e8e9d80f3cf52f65b260947d48`  
**Evidence base:** `e69a8e115f4dc2ef420a24b429be5b79fefd1e8d`  
**Promotion source:** `docs/plans/store/AWJ_STORE_TRUST_BUSINESS_IDENTITY_EVIDENCE.md`

| Order | Task ID | Status | Risk | Depends on | Outcome |
|---|---|---|---|---|---|
| 0 | STORE-TRUST-0 | done | normal | horizon definition | Evidence matrix + official-source registry + exact current-state classification |
| 1 | STORE-TRUST-STATE-1 | done | normal | STORE-TRUST-0 | Reconcile owner branding/storage deferral from open PR #1044 into durable main history without runtime change |
| 2 | STORE-TRUST-BIZ-1 | ready | high | STORE-TRUST-0 | Canonical legal name / CR / VAT / store-name presentation parity |
| 3 | STORE-TRUST-SBC-1 | done | high | STORE-TRUST-0; PR #926 merged | Post-merge SBC contract/security/visual parity verification; fix only proven gaps |
| 4 | STORE-TRUST-WA-1 | ready | normal | STORE-TRUST-0 | WhatsApp link + official icon evidence + Preview/Public parity |
| 5 | STORE-TRUST-SOCIAL-1 | ready | normal | STORE-TRUST-0 | Supported social links/icons, accessibility, URL safety, parity |
| 6 | STORE-TRUST-APPS-1 | ready | normal | STORE-TRUST-0 | App Store / Google Play links + official badge evidence + Footer/AppPromo parity |
| 7 | STORE-TRUST-COMPOSE-1 | pending | normal | BIZ/SBC/WA/SOCIAL/APPS merged and post-merge reviewed | Shared Footer grouping, density, responsive composition |
| 8 | STORE-TRUST-QA-1 | pending | high | implemented slices | RTL/LTR responsive + accessibility + security regression pass |
| 9 | STORE-TRUST-CLOSE-1 | pending | normal | all ready work closed | Closure report + durable CURRENT-STATE |

## STORE-TRUST-0 — Evidence Pass

Must produce a matrix with:

`Capability | Current merchant input | Canonical source | Draft persistence | Public payload | Preview | Published | Official asset source | Usage permission | URL validation | Tenant/RBAC | Gap | Classification | Next action`

Inspect first:

- Storefront presentation normalizer and TS twins;
- Footer;
- Storefront layout;
- Web Customizer control panels/canvas;
- current SBC implementation;
- WhatsApp/social/app link helpers;
- existing tests and capability docs.

External evidence must come from official first-party sources where available.

End each capability as one of:

- COMPLETE
- IMPLEMENTATION_READY
- ASSET_EVIDENCE_REQUIRED
- PRODUCT_DECISION_REQUIRED
- INFRA_DECISION_REQUIRED
- DEFERRED
- OUT_OF_SCOPE

Do not implement in STORE-TRUST-0.

## STORE-TRUST-STATE-1 — Branding/storage decision reconciliation

PR #1044 currently contains the owner-selected decision:

`KEEP_EMBEDDED_MEDIA_UNTIL_PERSISTENT_STORAGE_IS_AUTHORIZED`

Because it is not merged at horizon creation time, STORE-TRUST-0 must verify its current state.

This task is documentation/state reconciliation only unless the owner separately authorizes more.

It does not authorize merging #1044 automatically.

## STORE-TRUST-BIZ-1 — Business identity

Definition of Done:

- public legal identity comes only from resolved Tenant;
- no duplicate CR/VAT merchant authority;
- CR/VAT/legal name absence fails cleanly;
- public/store display name remains distinct;
- Preview and Published show the same semantic grouping;
- tenant negatives covered.

## STORE-TRUST-SBC-1 — SBC verification

Definition of Done:

- no unresolved P1/P2 from post-merge inspection;
- public loader only;
- authoring surfaces inert;
- token redaction rules preserved;
- text fallback preserved;
- tenant isolation verified;
- official-source evidence retained.

Do not rebuild #926.

## STORE-TRUST-WA-1 — WhatsApp

Definition of Done:

- current placement options preserved;
- invalid/empty link hides safely;
- Preview does not navigate;
- published link uses safe external semantics;
- official-brand presentation evidence recorded before official mark use;
- accessible text/label available.

## STORE-TRUST-SOCIAL-1 — Social

Definition of Done:

- only current supported networks are handled;
- invalid URLs fail closed;
- icon-only controls have accessible names;
- official or permitted mark source recorded;
- no arbitrary network HTML/embed;
- Preview/Public parity.

## STORE-TRUST-APPS-1 — App stores

Definition of Done:

- no badge/link without valid `iosUrl` / `androidUrl`;
- official badge source + permitted usage documented;
- Footer and AppPromo semantics aligned;
- one-link/two-link states work;
- Preview/Public parity;
- no claim that an app exists without a configured link.

## STORE-TRUST-COMPOSE-1 — Shared composition

Definition of Done:

- Business Identity, SBC, communication/social, applications remain semantically distinct;
- mobile and desktop intentionally laid out;
- no crowded logo wall;
- no horizontal overflow;
- no second Footer implementation.

## STORE-TRUST-QA-1 — Verification

Required widths:

390 / 430 / 768 / 1024 / 1280 / 1440.

Locales:

ar RTL / en LTR.

Must capture actual rendered evidence and distinguish dev harness evidence from production-route evidence.

## Deferred companion item

Business Documents Viewer V1 remains deferred because it needs durable media storage. It is not considered missing horizon work.

No task may work around that dependency with local container disk storage.
