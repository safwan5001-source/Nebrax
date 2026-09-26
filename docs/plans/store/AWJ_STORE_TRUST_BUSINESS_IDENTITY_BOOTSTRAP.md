# Bootstrap — AWJ Store Trust, Business Identity & External Brands Horizon V1

Repository:
`safwan5001-source/Nebrax`

Start from latest `origin/main`.

Horizon definition:
`docs/plans/store/AWJ_STORE_TRUST_BUSINESS_IDENTITY_HORIZON.md`

Queue:
`docs/plans/store/AWJ_STORE_TRUST_BUSINESS_IDENTITY_TASK_QUEUE.md`

Mandatory system:
`docs/autonomous-engineering/AWJ-HORIZON-SYSTEM.md`

## First action

Execute **STORE-TRUST-0 only**.

Do not implement UI or runtime code in the evidence task.

Verify exact latest `origin/main` and report it.

PR #926 is already merged and must be treated as current input, not reimplemented.

PR #1044 may still be open. Its owner-selected branding/storage decision is not permission to merge it automatically. Record its status and treat any reconciliation as STORE-TRUST-STATE-1.

## Evidence targets

Inspect:

- canonical Tenant legal identity fields;
- Storefront display identity;
- Footer business identity;
- SBC public and preview paths;
- WhatsApp configuration and URL handling;
- supported social networks and icons;
- iOS / Android app links;
- AppPromo;
- Store Customizer controls and preview;
- public response minimization;
- tenant isolation and `commerce.manage`;
- RTL/LTR and responsive state.

For external brands/assets, use first-party authoritative sources where available and clearly separate:

**External evidence**
from
**AWJ decision/proposal**.

Do not infer usage permission from another storefront's behavior.

## Deliverable

Create:

`docs/plans/store/AWJ_STORE_TRUST_BUSINESS_IDENTITY_EVIDENCE.md`

Include the matrix required by STORE-TRUST-0 and a dependency-safe promotion recommendation for the queue.

If a material choice is genuinely unresolved, create a narrowly scoped Decision Packet. Do not guess.

## Stop conditions

Stop and escalate before implementation if evidence requires:

- a new storage provider or upload architecture;
- a new government verification authority/integration;
- a new legal identity source;
- a new external brand not already in the product contract;
- an unsupported trademark/asset usage assumption;
- a new database/API architecture;
- finance/tax/payment semantics.

## Explicit exclusions

No Deploy.
No persistent-storage activation.
No Business Documents uploads.
No Promotions/Offers.
No broad customizer redesign.

## End

End STORE-TRUST-0 with exact classifications and the next ready task(s). Do not implement the next task in the same PR.
