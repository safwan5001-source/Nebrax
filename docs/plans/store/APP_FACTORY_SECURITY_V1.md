# AWJ App Factory Security V1 — Contract Draft

**Status:** Draft implementation-facing security contract  
**Parent:** `AWJ_APP_BUILDER_PRODUCT_ARCHITECTURE_V1.md`  
**Related:** `RUNTIME_COMPATIBILITY_V1.md`, `PREVIEW_SESSION_SECURITY_V1.md`

## 1. Purpose

This contract defines the security boundary for building, signing, validating, uploading and releasing merchant-branded iOS and Android apps through AWJ.

The App Factory handles some of the highest-impact credentials and operations in AWJ. A compromise could affect merchant application identity, store releases, signing material or customer trust.

Therefore:
- tenant isolation applies to build/release infrastructure, not only business data;
- signing secrets never live as ordinary tenant records;
- build workers are ephemeral and isolated;
- release operations are least-privilege, audited and idempotent;
- production submission/release requires explicit authorized approval.

## 2. Ownership model

Preferred default:

**Merchant owns Apple Developer/App Store Connect and Google Play developer accounts. AWJ operates as delegated builder/release operator with least privilege.**

This keeps:
- legal/seller identity with merchant;
- app ownership portable;
- offboarding simpler;
- account-level blast radius lower than a universal AWJ publisher account.

AWJ-owned publishing, if ever offered, is a separate exceptional product/legal/security model and is not baseline V1.

## 3. Account passwords are forbidden

AWJ must not request/store:
- merchant Apple ID password;
- Google account password;
- 2FA recovery codes;
- personal recovery secrets.

Integration uses platform-supported delegated/API/service credentials.

## 4. Roles

Conceptual AWJ roles:

### App Editor
Can prepare app experience/configuration. Cannot submit/release production native builds by default.

### Release Manager
Can approve authorized production build/submission/release operations for assigned app/tenant.

### Tenant Owner/Admin
Can connect/revoke merchant store accounts according to AWJ RBAC.

### AWJ Operations
Platform support role with tightly controlled exceptional access; no standing ability to impersonate merchant release authority without policy/audit.

Exact RBAC mapping is implementation work.

## 5. High-impact approval rule

Production operations such as:
- first store submission;
- new production version submission;
- release after approval;
- staged/phased rollout changes;
- production credential replacement/revocation;
- app transfer initiation

require explicit authorized intent.

No unattended production auto-release by default in V1.

## 6. Credential classes

Potential credential references include:

### Apple
- App Store Connect API credentials;
- signing/distribution certificate material where required;
- provisioning/profile/capability-related material;
- platform-generated identifiers.

### Google
- Google Play Developer API service identity/OAuth credential;
- upload key;
- Play App Signing configuration/reference;
- platform-generated identifiers.

### AWJ
- internal build-worker identity;
- artifact-store access;
- KMS/HSM references;
- release orchestration service identity.

Each class has separate scope/rotation/revocation policy.

## 7. Secret storage

Secrets must not be stored plaintext in normal tenant/business database columns.

Preferred architecture:
- dedicated secret manager;
- encryption at rest;
- KMS/HSM-backed key hierarchy where appropriate;
- tenant/app/platform-scoped secret references;
- strict service authorization;
- rotation/revocation;
- access audit.

Business DB stores opaque credential reference + metadata, not secret value.

## 8. Secret access

Build/release workers obtain secrets just-in-time.

```text
Authorized Release Job
 -> worker identity attestation/auth
 -> server verifies tenant/app/job
 -> short-lived secret lease
 -> use only for required operation
 -> revoke/expire lease
 -> destroy workspace
```

Do not inject broad permanent credentials into generic CI environments.

## 9. Least privilege

A credential must have the narrowest practical:
- account/app scope;
- role/permission;
- operation scope;
- lifetime.

One merchant app credential must not grant release authority over unrelated merchants.

Where platform constraints force broad credentials, AWJ must classify the elevated blast radius and add stronger isolation/approval/audit.

## 10. Apple credential implications

AWJ must account for platform constraints when choosing Apple automation credentials.

Team-level credentials that cannot be limited to a single app are higher risk for multi-merchant custody.

Prefer app/role-limited delegated access where platform supports it and avoid centralizing broad team authority unnecessarily.

Exact credential onboarding flow must be reverified against current Apple documentation at implementation time.

## 11. Android signing model

Preferred Android model:
- Google Play App Signing protects final app signing key where applicable;
- AWJ/merchant build pipeline uses an upload key;
- upload key is isolated per merchant/app or appropriately scoped;
- no universal upload key across unrelated merchants.

Upload-key loss/compromise follows Google-supported reset/recovery process.

## 12. iOS signing model

iOS signing material is isolated per merchant/team/app context as platform architecture requires.

Do not export/share private keys unnecessarily.

Where Apple-managed/cloud-managed signing can safely reduce private-key custody, evaluate it during implementation proof.

Provisioning/capability changes are treated as controlled native release configuration.

## 13. Build Request

A Build Request is an immutable authorized intent referencing:
- tenant/app;
- platform;
- native/runtime version;
- Published/approved Experience reference;
- build configuration;
- bundle/package identity;
- public app configuration;
- source/runtime/template revision;
- requested release target;
- actor;
- timestamp;
- approval state.

Changing meaningful inputs creates a new build request/revision.

## 14. Immutable build manifest

Before execution, resolve an immutable manifest containing at least:
- source revision/SHA;
- runtime revision/version;
- dependency lockfile identity;
- App Schema/Published Experience reference as applicable;
- app public configuration;
- bundle/package ID;
- version/build number;
- platform SDK/toolchain version;
- required capabilities;
- signing credential references, not secret values;
- build environment image/toolchain digest where possible.

This supports reproducibility and incident investigation.

## 15. Build worker isolation

Production builds run in ephemeral isolated workers.

Requirements:
- fresh workspace;
- tenant/app/job scoped;
- no unrelated merchant checkout;
- no persistent secret files after job;
- controlled network access;
- controlled artifact upload;
- worker destroyed after completion.

Do not reuse a dirty writable workspace across tenants.

## 16. Cache isolation

Build caches can leak source/config/artifacts if poorly scoped.

Policy:
- immutable public dependency caches may be shared if safe;
- tenant/app-sensitive caches are isolated;
- signing/provisioning secrets are never cached in shared layers;
- cache keys include relevant toolchain/source/security dimensions;
- poisoned cache detection/invalidation strategy exists.

## 17. Source and dependency integrity

Build uses:
- pinned source revision;
- lockfiles;
- trusted package registries;
- dependency integrity verification where available;
- controlled build scripts;
- no merchant-authored arbitrary shell commands in V1.

App Builder configuration cannot inject executable CI commands.

## 18. Supply-chain policy

Before production:
- dependency inventory/SBOM strategy;
- vulnerable dependency scanning;
- malicious package controls;
- provenance/build attestation where practical;
- trusted base images/toolchains;
- patch/update process.

A visual schema change must not be able to alter build scripts/dependencies.

## 19. Network egress

Build workers should use constrained network egress where practical.

Allowed examples:
- trusted dependency registries;
- Apple/Google build/upload services;
- AWJ artifact/secret services;
- explicitly required provider endpoints.

Do not give arbitrary merchant schema control over build-worker network requests.

## 20. Artifact handling

Artifacts include:
- IPA/archive outputs;
- AAB/APK outputs where applicable;
- symbol/debug files;
- manifests;
- validation reports;
- provenance/attestation;
- store upload metadata.

Artifacts are scoped by tenant/app/build/platform and protected from cross-tenant access.

## 21. Artifact integrity

Store cryptographic digest for release artifact.

Release record links:
- Build Request;
- immutable manifest;
- artifact digest;
- signer/signing context;
- validation result;
- upload external IDs;
- actor/approval.

The uploaded artifact must be the same artifact that passed required validation/approval.

## 22. Artifact retention

Define retention by artifact type.

Do not retain secret-bearing temporary workspaces.

Longer retention may be justified for:
- released binaries;
- symbols needed for crash diagnostics;
- manifests/provenance;
- audit evidence.

Retention must consider storage cost, privacy and incident needs.

## 23. Logs

Build logs must redact:
- credentials;
- private keys;
- provisioning secrets;
- access/refresh tokens;
- authorization headers;
- payment/provider secrets;
- sensitive environment variables.

Avoid commands that echo secret-bearing environment variables.

## 24. Build validation

Before upload:
- build success;
- artifact integrity;
- bundle/package identity;
- version/build number;
- runtime/capability manifest;
- required signing state;
- platform validation/lint where available;
- no debug/test environment accidentally selected;
- no Preview endpoint/config in Production binary;
- production API/domain configuration correct.

## 25. Environment separation

Separate:
- Development;
- Preview/Test;
- Release Candidate/Beta;
- Production.

A Production build must not silently use:
- sandbox payment endpoint;
- Preview Session endpoint;
- test push project;
- development tenant host;
- debug logging/secrets.

Conversely Preview/Test must not inherit Production mutation credentials unnecessarily.

## 26. Bundle/package identity

Bundle ID / application ID is a controlled app identity.

Changes are high impact and cannot be treated like theme settings.

Builder UI may display identity, but only authorized release/settings workflow can change it.

App transfer/migration requires special preflight.

## 27. Version/build numbers

AWJ centrally coordinates valid platform version/build identifiers per app.

Concurrency-safe allocation prevents duplicate/conflicting uploads.

Retrying a failed upload should reuse or deliberately advance identifiers according to platform state, not blindly generate duplicates.

## 28. Upload

Upload operation:
- verifies approved Build Request;
- verifies artifact digest;
- acquires platform credential JIT;
- uploads exactly intended artifact;
- records external build/version ID;
- is idempotent/reconcilable.

Timeout after upload must trigger reconciliation before retry to avoid duplicate/conflicting store state.

## 29. Submission

Upload != submission != review != release.

AWJ Release Center models each separately.

Submission requires:
- required store metadata/config;
- legal/privacy/compliance declarations as applicable;
- selected uploaded build;
- explicit authorized approval;
- external response recorded.

API automation does not bypass Apple/Google review or legal requirements.

## 30. Release

Approval by store does not automatically mean AWJ should release unless merchant selected an approved release policy.

Supported conceptual policies:
- manual release;
- scheduled release where platform permits;
- phased/staged rollout;
- automatic-after-approval only if merchant explicitly configured/approved and V1 policy allows it.

Default V1 remains controlled/manual for production.

## 31. Rollout changes

Changing phased/staged rollout percentage/status is a production action.

Require:
- Release Manager authorization;
- current store-state reconciliation;
- audit;
- idempotent platform operation.

Google staged percentage must not be assumed to increase automatically.

## 32. Store-state reconciliation

External platforms are authoritative for external store state.

AWJ stores normalized + raw platform state.

Periodic/event-driven reconciliation should handle:
- processing delays;
- review changes;
- rejection/action required;
- release state;
- phased/staged state;
- external manual changes made outside AWJ.

Do not overwrite unknown external state with optimistic local assumptions.

## 33. Idempotency

Required for:
- build request creation where duplicate trigger matters;
- version/build allocation;
- artifact upload;
- submission;
- release command;
- rollout change;
- credential onboarding/revocation workflows where applicable.

Each external operation needs stable operation identity and reconciliation.

## 34. Concurrency

Prevent:
- two production builds claiming same version/build;
- two actors submitting different artifacts as same release;
- release while replacement artifact is being approved;
- credential rotation mid-sign without deterministic handling.

Use server-side locks/state transitions where appropriate.

## 35. State machine

Conceptual normalized release states:

```text
Draft Release
 -> Validating
 -> Build Queued
 -> Building
 -> Build Failed | Built
 -> Signing
 -> Signed
 -> Uploading
 -> Uploaded
 -> Store Processing
 -> Ready for Submission
 -> Submitted
 -> In Review
 -> Rejected / Action Required / Approved
 -> Scheduled / Phased / Staged / Released
 -> Superseded
```

Raw Apple/Google state remains available for diagnostics.

## 36. State-transition authorization

Every high-impact transition has allowed actor/role and preconditions.

Client cannot PATCH arbitrary release state to “Released”.

External platform callbacks/reconciliation are authenticated/verified and mapped through trusted server logic.

## 37. Store metadata

Store listing metadata is separate from runtime Experience.

Changes such as description/screenshots/keywords may follow platform-specific submission/review rules and may not require a new binary.

AWJ must classify these independently and verify current platform rules at implementation time.

## 38. Merchant onboarding

Connection flow should guide merchant through:
- ownership/account prerequisites;
- organization/legal identity where applicable;
- AWJ delegated access;
- app registration/identity;
- signing setup;
- API access;
- validation test;
- least-privilege confirmation.

AWJ displays only necessary instructions and does not ask for account passwords.

## 39. Credential validation

After connection:
- validate credential works;
- validate expected merchant/team/account;
- validate expected app access;
- validate required permissions;
- detect excessive/missing permissions where possible;
- store only safe metadata + secret reference.

Do not wait until production release to discover unusable credentials.

## 40. Rotation

Support:
- API credential rotation;
- upload key rotation/reset flow;
- certificate lifecycle;
- internal worker/service identity rotation.

Rotation must avoid cross-tenant credential mix-up and preserve auditable before/after state.

## 41. Revocation

Merchant can revoke AWJ delegated release access.

AWJ must:
- stop new privileged jobs;
- invalidate local credential references/leases;
- preserve non-secret audit/history;
- mark release integration disconnected;
- not delete merchant-owned store app.

Revocation is not app deletion.

## 42. Offboarding

With merchant-owned store accounts:
- merchant retains app/store listing;
- AWJ access is revoked;
- AWJ secrets/credential references are retired according to policy;
- merchant receives required ownership/config handoff information;
- AWJ retains only legally/security-required audit evidence.

Normal offboarding should not require app transfer.

## 43. App transfer

Transfer is exceptional, not one-click.

Preflight must inspect platform-specific constraints such as:
- signing;
- push;
- associated domains/deep links;
- Apple capabilities/services;
- Google Play App Signing/upload key;
- provider integrations;
- subscription/payment implications;
- TestFlight/testing/release state.

Exact checklist is verified against current platform docs at transfer time.

## 44. Incident response

Credential/signing incident playbook must support:
- identify affected tenant/app/platform;
- disable queued privileged jobs;
- revoke/rotate credential;
- preserve audit;
- reconcile store state;
- assess released artifact exposure;
- communicate to authorized merchant contacts;
- recover using platform-supported procedures.

Do not rotate unrelated merchant credentials without evidence.

## 45. Cross-tenant security tests

Required:
- Tenant A cannot view/download Tenant B artifact;
- Tenant A cannot reference Tenant B credential;
- build worker A cannot read workspace/cache/secret B;
- release request cannot submit artifact from another tenant/app;
- external IDs are revalidated against local tenant/app mapping;
- support/admin access is scoped/audited;
- artifact signed for App A cannot be substituted into App B release.

## 46. Approval/audit evidence

For production release preserve:
- requesting actor;
- approving actor if separation required;
- tenant/app;
- manifest;
- source SHA;
- artifact digest;
- platform;
- credential reference identity, not secret;
- validation results;
- upload/submission IDs;
- store response/state;
- timestamps;
- rollout commands.

## 47. Break-glass access

If AWJ later needs operational break-glass:
- disabled by default;
- strong authentication;
- explicit reason/ticket;
- time-limited;
- least scope;
- full audit;
- merchant notification policy where appropriate.

No shared permanent superuser signing credential.

## 48. Backward compatibility

App Factory changes must not invalidate existing released apps/signing ownership.

Migrations affecting credential references, release records or artifact metadata require safe backward-compatible transition.

Never rotate/reissue signing identity casually as part of refactor.

## 49. Cost/resource abuse

Builds are expensive.

Controls:
- authorization;
- quotas/rate limits;
- deduplicate identical requests where safe;
- cancel queued builds;
- worker time/resource limits;
- artifact/storage retention policy;
- abuse monitoring.

Cost controls must not weaken required security validation.

## 50. V1 exclusions

- merchant arbitrary CI scripts;
- merchant arbitrary native package installation;
- shared universal signing key;
- storing account passwords/2FA recovery;
- unattended auto-release by default;
- AWJ-owned developer account as default;
- one-click blind app transfer;
- secret exposure to Builder/runtime;
- cross-tenant shared writable build workspace.

## 51. Implementation proof gate

Before production App Factory implementation is considered ready, prove with controlled test apps:

### Apple
- delegated account/app access;
- API credential scope;
- signing/build path;
- upload;
- processing/status read;
- TestFlight path;
- submission/release-state handling;
- revoke/rotate.

### Google
- delegated Play access;
- Developer API identity;
- Play App Signing;
- app-specific upload key path;
- upload;
- testing track;
- staged rollout controls;
- revoke/reset path.

### AWJ
- ephemeral worker isolation;
- secret JIT access;
- artifact tenant isolation;
- immutable manifest/digest;
- idempotent retry/reconciliation;
- audit/redaction.

No merchant production app should be the first proof target.

## 52. Open decisions

- secret manager/KMS/HSM provider;
- build execution provider;
- macOS build worker strategy;
- Flutter build orchestration;
- Apple individual vs team API key usage per onboarding case;
- cloud-managed Apple signing feasibility;
- upload key generation/custody flow;
- artifact store/retention;
- SBOM/provenance standard;
- approval separation-of-duties policy;
- store metadata automation scope;
- webhook vs polling reconciliation;
- release scheduling UX;
- crash symbol retention;
- merchant export/handoff package;
- support/break-glass governance.

## 53. Acceptance criteria

APP_FACTORY_SECURITY_V1 can be implementation-locked when:

1. merchant-owned store accounts are the default ownership model;
2. no account passwords/2FA recovery secrets are collected;
3. signing/store credentials live behind dedicated secret-management references;
4. workers are ephemeral and tenant/app isolated;
5. build manifest and release artifact are immutable/digest-linked;
6. production upload/submission/release is authorized, audited and idempotent;
7. external store state is reconciled rather than guessed;
8. cross-tenant artifact/credential/submission negatives pass;
9. credential revoke/rotation/offboarding flows are proven;
10. Apple and Google proof gates succeed with controlled test apps before merchant production use.
