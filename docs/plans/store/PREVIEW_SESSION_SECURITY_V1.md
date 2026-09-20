# AWJ Preview Session Security V1 — Contract Draft

**Status:** Draft implementation-facing security contract  
**Parent:** `AWJ_APP_BUILDER_PRODUCT_ARCHITECTURE_V1.md`  
**Related:** `APP_SCHEMA_V1.md`, `DATA_RESOURCE_REGISTRY_V1.md`, `ACTION_REGISTRY_V1.md`, `RUNTIME_COMPATIBILITY_V1.md`

## 1. Purpose

This contract defines the security boundary for previewing an unpublished AWJ mobile app experience on Builder Canvas, interactive runtime and real devices.

Preview is a privileged development/test surface. It must never become a shortcut around Tenant Isolation, authentication, Commerce authorization, production mutation controls or Published Experience isolation.

## 2. Preview fidelity ladder

AWJ distinguishes:

1. **Canvas Preview** — fast Builder rendering/simulation.
2. **Interactive Runtime Preview** — executes real declarative runtime semantics under Preview policy.
3. **Real Device Preview** — authorized short-lived Preview Session opened in AWJ Preview Runtime/App.
4. **Release Candidate/Beta** — actual merchant-branded binary tested through platform-appropriate distribution.

A Real Device Preview is not a production release and must be visibly identified as Preview.

## 3. Core trust rule

A QR code, universal/app link or preview reference is **routing/bootstrap material, not authority**.

Never encode in a preview link:
- raw tenant authority;
- permanent access token;
- refresh token;
- provider secret;
- signing credential;
- full App Schema;
- customer credential;
- reusable privileged bearer token.

## 4. Preview Session

Conceptual server-side resource:

```text
PreviewSession
- id
- opaque_public_reference
- tenant_id                  [server-owned]
- app_id                     [server-authorized relation]
- draft_revision/snapshot_id
- environment
- created_by
- created_at
- expires_at
- revoked_at
- allowed_preview_capabilities
- data_mode
- optional tester/device binding
- audit metadata
```

This is a security model, not an approved DB migration/schema.

## 5. Session creation

Creating a Preview Session requires authenticated Builder authorization for the target tenant/app.

Server resolves:
- current tenant;
- app ownership/relation;
- selected Draft/snapshot;
- allowed environment/data mode;
- creator permissions.

Client cannot create a session for another tenant by submitting its tenant ID.

## 6. Opaque reference

The public preview reference must be:
- high entropy;
- non-sequential;
- unguessable;
- revocable;
- short-lived;
- scoped to one Preview Session.

Prefer storing only a hashed verifier where practical for bearer-style references.

A leaked reference should have limited lifetime and capability.

## 7. QR / link flow

Preferred conceptual flow:

```text
Builder
 -> create Preview Session
 -> receive opaque short-lived reference
 -> render QR/universal link
 -> AWJ Preview App opens reference
 -> server resolves session
 -> authenticate tester when required
 -> authorize tenant/app/session
 -> issue bounded preview access/session
 -> fetch pinned Draft snapshot
```

Do not place serialized Draft schema directly in QR.

## 8. Authentication modes

Default V1 should require an authenticated authorized tester for tenant-real-data preview.

Possible future modes:
- owner/team authenticated preview;
- explicitly invited tester;
- deliberately restricted guest/sample preview.

Guest preview must never inherit real-data access merely because a QR was shared.

## 9. Authorization

At redemption and every protected request verify:
- Preview Session exists and is active;
- not expired/revoked;
- tenant/app relationship remains valid;
- tester has required access where applicable;
- requested Draft/snapshot matches session;
- requested capability allowed;
- data mode allowed;
- environment allowed.

Do not rely on one-time QR redemption as permanent authorization.

## 10. Tenant Isolation

Non-negotiable:
- tenant resolved from server-owned Preview Session/auth context;
- client tenant ID cannot switch scope;
- AppRef/DraftRef validated within tenant;
- cross-tenant references return safe denial/not-found;
- caches include tenant/app/session/environment/security context;
- pagination/media/resource references cannot cross tenant;
- logs do not leak foreign object existence.

Preview APIs receive the same or stricter Tenant Isolation testing as production Commerce APIs.

## 11. Draft isolation

Three distinct paths:

```text
Production App
 -> Published Experience endpoint

Preview Runtime
 -> Preview Session
 -> Draft Snapshot endpoint

Builder Canvas
 -> authenticated Builder Draft path
```

Never expose Draft by adding a generic client-controlled `?preview=true` to the production Published endpoint.

## 12. Snapshot policy

Shareable Real Device Preview should prefer a **pinned immutable snapshot**.

Benefits:
- tester sees known revision;
- reproducible bug report;
- no mid-session structural mutation;
- auditability.

Builder-local preview may follow working Draft for rapid authoring.

UI must show which snapshot/revision is being viewed.

## 13. Session lifetime

Preview Sessions expire automatically.

Exact TTL remains open and should balance mobile usability with security.

Requirements:
- server-enforced expiration;
- explicit revoke;
- app/team permission revocation takes effect;
- old sessions cannot silently reactivate;
- expired QR displays safe recovery instructions.

## 14. Revocation

Revocation triggers may include:
- creator manually revokes;
- app deleted/disabled;
- tester access removed;
- tenant/user security event;
- Draft snapshot deleted according to retention policy;
- security administrator invalidation.

Runtime should stop protected preview access promptly after server detects revocation.

## 15. Preview data modes

### Sample Data

Synthetic fixtures only.

Use for:
- layout;
- RTL/LTR;
- empty/loading/error simulations;
- safe demos.

No production customer PII.

### Tenant Read Data

Authorized tenant Commerce data under read policy.

Use for:
- real catalog;
- publication;
- media;
- pricing/availability display where allowed.

Customer-specific data requires authenticated customer/test context and stricter controls.

### Test / Sandbox Commerce

Preferred for mutation testing:
- test cart;
- sandbox checkout;
- sandbox payment provider;
- test orders where architecture supports them.

Sandbox/test objects must be distinguishable from production business records.

## 16. Production mutation policy

Default Preview policy:

```text
Local UI actions        -> allowed
Safe navigation         -> allowed
Authorized reads        -> allowed by data mode
Test/sandbox mutations  -> allowed where supported
Production mutations    -> blocked by default
Sensitive mutations     -> blocked by default
```

Schema cannot override this matrix.

## 17. Explicit production mutation exception

If a future workflow genuinely needs a production mutation during Preview, it requires:
- separate permission;
- explicit user confirmation;
- prominent production warning;
- server-side allowlist;
- full audit;
- narrow action scope;
- no silent background execution.

V1 should avoid this unless a concrete validated need exists.

## 18. Payment safety

Preview must not accidentally charge a real customer/payment method.

Preferred:
- sandbox/test provider credentials;
- provider test mode;
- explicit environment indicator;
- test checkout context.

If provider lacks safe sandbox capability, Preview payment action remains disabled until a deliberate test architecture is approved.

A visual payment screen may be simulated without pretending payment succeeded.

## 19. Order safety

Preview must not silently create production sales orders/invoices merely to demonstrate checkout.

Use:
- sandbox/test order flow;
- simulated result;
- isolated test Commerce context,

depending on backend readiness.

Any accounting-impacting production record creation is blocked by default.

## 20. Customer PII

Shared Preview must not automatically expose:
- customer lists;
- customer addresses;
- order history;
- phone/email;
- payment-related personal data.

Tenant Read Data defaults to non-customer-specific Commerce catalog data.

Customer/account/order preview requires explicit authenticated test context and data-minimization policy.

## 21. Secrets

Never expose in Preview payloads/logs/UI:
- AWJ service secrets;
- payment provider secret keys;
- Apple/Google credentials;
- signing keys;
- backend DB credentials;
- unrestricted integration tokens;
- production refresh/access tokens.

Secret-bearing integrations terminate server-side.

## 22. Runtime credential

After preview reference redemption, prefer a bounded short-lived credential/session rather than repeatedly using the QR bearer reference.

Credential should be scoped to:
- Preview Session;
- app;
- allowed capabilities;
- environment;
- expiration;
- tester/device context where applicable.

Exact token format remains open.

## 23. Device binding

Optional V1/later hardening:
- bind redeemed session to Preview App installation/device key;
- limit simultaneous devices;
- revoke individual device binding.

Do not use invasive device fingerprinting as the default identity mechanism.

## 24. Preview App identity

Dedicated AWJ Preview App/runtime must clearly display:
- PREVIEW status;
- merchant/app identity;
- environment/data mode;
- Draft snapshot/revision;
- compatibility warnings.

It must not masquerade as the final merchant-branded production app.

## 25. Preview Runtime capabilities

Preview Runtime contains only AWJ-approved compiled capabilities.

It cannot download/execute merchant-authored native code.

Draft schema can invoke only Component/Action/Data capabilities already present in Preview Runtime and allowed by session policy.

## 26. Compatibility

Preview must report:
- Preview Runtime version;
- Draft required capabilities;
- unsupported capabilities;
- production runtime compatibility.

A Draft working in newest Preview Runtime does not prove current production binaries can run it.

Builder should show this distinction.

## 27. Deep links

Preview deep links resolve within Preview Session context.

A production app link should not accidentally open unpublished Draft content without an authorized Preview Session.

Incoming IDs remain untrusted and resource authorization still applies.

## 28. Media

Preview Draft assets and Commerce media require authorized URLs/paths.

Avoid permanent public exposure of unpublished/private assets.

Where signed URLs are used:
- short lifetime;
- correct tenant/app/object scope;
- no secret query logging;
- CDN/cache policy respects privacy.

## 29. Cache isolation

Preview cache keys must include relevant:
- tenant;
- app;
- Preview Session/snapshot;
- environment/data mode;
- locale/market;
- authenticated customer/test identity where applicable.

Never let Preview Draft responses poison production Published caches.

## 30. Diagnostics

Allowed diagnostics:
- schema version;
- Preview Runtime version;
- capability support;
- component/binding validation errors;
- sanitized resource/action status;
- navigation/event traces;
- environment/data mode;
- current snapshot;
- correlation IDs.

Diagnostics must redact secrets and unnecessary PII.

## 31. Network inspector

Develop/Preview diagnostics may show:
- registered resource/action name;
- timing;
- status;
- sanitized typed parameters/results.

Do not expose raw Authorization headers, provider secrets, payment credentials or unrestricted backend internals.

## 32. Screenshot/share risk

AWJ cannot prevent an authorized tester from taking screenshots of visible data.

Therefore:
- minimize sensitive Preview data;
- visibly mark Preview;
- optionally watermark shared tester preview with safe app/tester/session marker later;
- never use watermark as authorization control.

## 33. Rate limiting

Protect:
- session creation;
- QR redemption;
- Draft fetch;
- resource/action requests;
- failed auth attempts.

Limits must be scoped to avoid cross-tenant denial-of-service coupling.

## 34. Audit

Record relevant events:
- Preview Session created;
- creator;
- app/tenant internally;
- snapshot;
- data mode/environment;
- tester invited/redeemed;
- device binding if used;
- revoked/expired;
- sensitive denied action attempts;
- explicitly allowed production mutation if ever supported.

Audit data follows retention/privacy policy.

## 35. CSRF / origin / app transport

Browser-based Builder preview endpoints require appropriate CSRF/origin/session protections.

Mobile Preview Runtime uses platform-appropriate secure transport/authentication.

All Preview traffic requires TLS.

Do not rely solely on Origin for tenant authorization.

## 36. Replay protection

Preview bearer/bootstrap references are short-lived and revocable.

Sensitive mutation actions, if allowed in sandbox, use normal Action Registry idempotency/replay protections.

A captured old Preview Session must not regain access after revoke/expiry.

## 37. Brute-force resistance

Opaque references require sufficient entropy and server rate limiting.

Responses should not reveal whether a guessed reference belonged to another tenant.

## 38. Error behavior

Safe states:
- invalid link;
- expired;
- revoked;
- sign-in required;
- unauthorized;
- snapshot unavailable;
- incompatible Preview Runtime;
- resource unavailable;
- action blocked in Preview.

Avoid exposing internal tenant IDs, secret identifiers or stack traces.

## 39. Release Candidate boundary

Real Device Preview is for experience/runtime testing.

Release Candidate/Beta is required when validating:
- actual merchant bundle/package identity;
- merchant icon/splash/bundled assets;
- native SDK;
- native permissions/entitlements;
- push entitlement/config;
- universal/app links;
- signing;
- store processing;
- release build behavior.

Do not treat Preview App success as evidence that merchant-branded release signing/configuration works.

## 40. Platform distribution policy gate

The exact long-term distribution model for a shared AWJ Preview App must be verified against current Apple/Google platform policy before implementation.

Architecture must not assume a mechanism that would amount to downloading executable merchant code.

AWJ Preview remains declarative over compiled approved runtime capabilities.

## 41. Security tests

Required at minimum:
- valid authorized session;
- expired session;
- revoked session;
- guessed/invalid reference;
- cross-tenant app reference;
- cross-tenant Draft reference;
- cross-tenant resource/media reference;
- removed tester permission;
- Draft vs Published endpoint isolation;
- Preview cache vs production cache isolation;
- blocked production cart/order/payment mutation;
- sandbox mutation success where supported;
- no secrets in QR;
- no secrets in diagnostics/logs;
- snapshot pinning;
- unsupported capability;
- replay after revoke;
- customer/order ownership negatives.

## 42. Open decisions

- Preview Session TTL;
- tester invitation model;
- exact token/session format;
- device binding in V1 vs later;
- dedicated Preview App distribution model;
- sample-data fixture ownership;
- sandbox Commerce implementation;
- test customer identities;
- test order lifecycle;
- payment-provider sandbox matrix;
- watermarking;
- Preview asset URL strategy;
- Preview Session concurrency/device limit;
- audit retention;
- offline Preview behavior.

## 43. Acceptance criteria

PREVIEW_SESSION_SECURITY_V1 can be implementation-locked when:

1. QR/link contains no durable authority/secrets/full schema;
2. tenant/app/Draft scope is server-owned and cross-tenant negatives are defined;
3. Draft cannot be fetched from production Published endpoint via client flag;
4. shareable previews use reproducible snapshot semantics;
5. expiration/revocation are server-enforced;
6. Preview data modes are explicit;
7. production-sensitive mutations are blocked by default;
8. sandbox/test payment/order path is defined before enabling mutation testing;
9. diagnostics are useful but secret/PII-safe;
10. Preview Runtime compatibility is distinct from production compatibility;
11. Release Candidate boundary is explicit;
12. platform policy feasibility is verified before committing to shared Preview App distribution.
