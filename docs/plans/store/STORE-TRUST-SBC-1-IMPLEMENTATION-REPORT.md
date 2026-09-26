# STORE-TRUST-SBC-1 — Implementation Report

STATUS: Verification only. No code change. No rebuild of PR #926.
DATE: 2026-09-26

## Outcome

The merged SBC presentation from PR #926 still matches the V1 contract. No proven P1 or P2. No runtime diff in this task.

## Repository evidence / root cause

Evidence classified SBC as `IMPLEMENTATION_READY` with no P1, and required a post-merge confirmation rather than a rebuild. This pass re-read the contract and the current implementation on main `f7db2b5bf1cd86e6dfc79c962e862bc7136e78b7` (the worktree also contains later unmerged BIZ/WA/SOCIAL/APPS commits; the SBC files below were not changed by those commits).

Checked:

- `docs/AWJ_STORE_SBC_VERIFICATION_V1_CONTRACT.md` §3–§7.1 and §8–§10.
- `StorefrontConfigController` blanks `authentication_number` on every public response and blanks `seal_token` unless `show_in_storefront` is true.
- `StorefrontPresentationPublicRuntimeTest` asserts that redaction per storefront.
- The normalizer forces `verification.requestedVerifiedLabel` to false and does not treat SBC fields as Tenant identity.
- Published `SbcSeal` loads only `https://eauthenticate.saudibusiness.gov.sa/EAuthSealApi/seal.js`, and only when a token exists. Loader failure keeps the text label. The label is not rewritten into pending, unverified, or expired copy.
- Customizer and dev-mirror previews use an inert note. They do not insert `seal.js` or put the token on a loader. Architecture and ExperienceBuilder tests assert that.
- `show_in_storefront` false omits the footer item.
- ON without a token still shows `موثّق في منصة الأعمال` / the existing locale string. That is the AWJ presentation label, not a verification result.
- The customer footer does not render `authentication_number`.

## Approach chosen

Do not change code. Record the confirmation.

## Why this approach fits AWJ

The horizon says fix only a proven gap and do not rebuild #926. None was proven.

## Changed files

- `docs/plans/store/STORE-TRUST-SBC-1-IMPLEMENTATION-REPORT.md`
- `docs/plans/store/AWJ_STORE_TRUST_BUSINESS_IDENTITY_TASK_QUEUE.md` (status)
- `docs/plans/store/STORE-TRUST-0-IMPLEMENTATION-REPORT.md` (POST_MERGE fact now observed)
- `docs/plans/store/STORE-TRUST-STATE-1-IMPLEMENTATION-REPORT.md` (merge SHA)
- `docs/autonomous-engineering/CURRENT-STATE.md`

## Tests and exact results

No new tests. Existing public-runtime, normalizer, Footer, and preview tests were not re-executed in this docs pass. Storefront and web CI on the unmerged BIZ head already passed after the identity edits, which do not change the seal loader.

## Build / lint / typecheck

Not run. Docs only.

## CI

Recorded on the PR for the exact head.

## Pre-merge review

- PRE_MERGE_REVIEW: pending the PR comment for the exact head
- Reviewed Head SHA:
- Findings / resolution:

## Merge

- Merge status: not merged
- Merge SHA:

## Post-merge review

- POST_MERGE_REVIEW: pending
- Reviewed Merge SHA:
- Target-branch checks/smoke:
- Findings / resolution:

## Self-review

### Implementer

No seal script, token rule, or label was edited. ON without a token stays a text label.

### Reviewer

No schema, no new government integration, no second identity field.

### AWJ Guardian

SBC remains presentation. It does not mutate Tenant name, CR, VAT, tax, checkout, or accounting. The official artwork stays on the government loader.

## Accounting impact

None.

## Tenant / branch isolation impact

None. The public query remains tenant-scoped through the existing storefront context.

## Security / authorization impact

No change. Public redaction of `authentication_number`, and of `seal_token` when the footer is off, stays as shipped.

## Backward compatibility

No payload change.

## API / DB / migration impact

None.

## External research used

The loader URL is the one already in the contract and evidence. This task did not fetch a new asset.

## Risks / remaining work

Footer grouping is STORE-TRUST-COMPOSE-1. Visual widths are STORE-TRUST-QA-1. STATE-1 post-merge CI was still the open gate when this report was written.

## Discovered backlog

None inside this horizon. A future official lookup of the authentication number remains out of scope.

## Git state

- Branch: `docs/store-trust-sbc-1`
- PR:
- Base SHA: `f7db2b5bf1cd86e6dfc79c962e862bc7136e78b7`
- Head SHA:

## Recommended next dependency-ready task

STORE-TRUST-BIZ-1, WA-1, SOCIAL-1, and APPS-1. COMPOSE waits until those four are merged and post-merge reviewed, together with this verification.
