# Bootstrap — AWJ Store Official Brand, Contact & Payment Marks Horizon V1

Repository:
`safwan5001-source/Nebrax`

Start from latest `origin/main`.

Horizon:
`docs/plans/store/AWJ_STORE_BRAND_ASSETS_HORIZON.md`

Queue:
`docs/plans/store/AWJ_STORE_BRAND_ASSETS_TASK_QUEUE.md`

Mandatory process:
`docs/autonomous-engineering/AWJ-HORIZON-SYSTEM.md`

## First action

Execute **STORE-BRAND-0 only**.

Do not implement assets or runtime code during the evidence pass.

Verify exact latest `origin/main` and record the Base SHA.

The preceding Store Trust horizon is closed. Treat its implementation as current input, including:

- WhatsApp/social links already exist;
- official social/WhatsApp marks were intentionally not shipped without evidence;
- App Store / Google Play link/badge behavior already has existing implementation that must be verified rather than blindly replaced;
- Footer grouping exists;
- Railway may auto-deploy merged `main`, so reports must distinguish “no manual deploy triggered” from actual production deployment state;
- because of that behavior, runtime-changing PRs must stop before merge unless Safwan has explicitly authorized the Production impact of that merge (or a separately authorized deployment gate has first removed that automatic Production effect).

## Evidence work

Inspect current repository behavior first.

Then use first-party authoritative brand sources for external marks.

Cover:

- WhatsApp;
- Instagram;
- X;
- TikTok;
- Snapchat;
- YouTube;
- LinkedIn;
- Facebook;
- App Store;
- Google Play;
- phone/email/address/hours utility icons;
- existing payment capability and configuration;
- mada/Visa/Mastercard/Apple Pay/Google Pay only as candidates to verify, never assumptions.

## Critical payment rule

Do not render payment marks from a static design list.

First prove the authoritative supported+enabled payment-method source for the specific storefront/channel.

If no such source exists, create a Decision Packet and stop that payment slice. That resolved decision-gated/deferred payment state must not block the non-payment composition, QA, or horizon closure.

No payment gateway integration or financial behavior may be introduced.

## Deliverable

Create:

`docs/plans/store/AWJ_STORE_BRAND_ASSETS_EVIDENCE.md`

Include the queue matrix and exact classifications.

Promote only dependency-ready tasks.

## Stop conditions

Stop and escalate before implementation if the work requires:

- a new payment integration;
- a new payment-method source-of-truth;
- a DB/API contract change not already authorized;
- persistent/object storage architecture;
- unsupported trademark assumptions;
- a new social/contact capability;
- finance/accounting/ZATCA changes;
- deployment configuration changes.

## Explicit exclusions

No manual Deploy.
No Checkout redesign.
No Promotions.
No persistent merchant-media work.
No broad Customizer redesign.
No unrelated refactor.

## End of STORE-BRAND-0

Report:

- exact Base SHA;
- evidence file;
- classification per capability;
- next dependency-ready task(s);
- any Decision Gate.

Do not implement the next task in the same PR.
