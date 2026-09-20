# AWJ App Schema V1 — Contract Draft

**Status:** Draft contract for architecture closure — not an implementation API yet  
**Parent:** `AWJ_APP_BUILDER_PRODUCT_ARCHITECTURE_V1.md`  
**Scope:** Declarative experience contract between AWJ Builder and trusted AWJ mobile runtime.

## 1. Purpose

App Schema V1 describes **how an AWJ commerce app experience is composed and configured**. It does not duplicate AWJ Commerce business data and it does not grant authority.

The contract must remain framework-neutral: no Flutter widget class names, Dart expressions, React Native component names, Swift/Kotlin types, SQL, arbitrary URLs, executable scripts or tenant authority are persisted as merchant-authored experience behavior.

Core boundary:

```text
AWJ Builder
  -> App Schema V1
  -> validate + compatibility + authorization
  -> Published Experience Version
  -> Trusted AWJ Runtime
  -> registered Data / Action capabilities
  -> tenant-scoped AWJ Commerce Core
```

## 2. Source-of-truth rule

App Schema stores **references and presentation intent**, not copies of business truth.

Examples:

- Product Grid stores a binding to an approved Products resource, not product rows.
- Category navigation references approved Category resources, not a duplicated category database.
- Price is returned by AWJ Commerce; a merchant cannot author an authoritative price in schema.
- Stock/availability comes from AWJ Commerce.
- Cart operations invoke registered cart actions.
- Checkout/payment invoke trusted AWJ backend/payment capabilities.
- Customer/account/order data remains server-authoritative.
- Shipping/delivery options remain governed by AWJ Commerce rules.

Storefront and mobile app therefore consume the same business truth while having separate presentation experiences.

## 3. Security model

Treat every schema document as untrusted configuration.

Schema MUST NOT contain:
- database credentials;
- provider/API secrets;
- signing certificates/private keys;
- reusable privileged bearer tokens;
- raw SQL;
- arbitrary executable code/eval;
- arbitrary filesystem/network commands;
- authority to choose/switch tenant context;
- client-side rules that override server pricing, tax, payment, inventory or authorization.

Every sensitive data/action capability is re-authorized by AWJ backend using authenticated runtime context.

## 4. Top-level conceptual document

Names below are contract candidates and may be refined before implementation lock.

```json
{
  "schemaVersion": "1.x",
  "experienceId": "opaque-id",
  "appId": "opaque-id",
  "version": 12,
  "runtimeCompatibility": {
    "minimum": "candidate-capability-version"
  },
  "locales": ["ar", "en"],
  "defaultLocale": "ar",
  "theme": {},
  "navigation": {},
  "pages": [],
  "assets": [],
  "metadata": {}
}
```

Tenant ID is intentionally absent as an authority-bearing field. Server context owns tenant resolution.

## 5. Identity and version fields

Required conceptual identities:
- `experienceId`: stable experience identity;
- `appId`: authorized AWJ app relation;
- `version`: immutable Published version number/identifier;
- `schemaVersion`: parser/contract version;
- runtime/capability compatibility declaration.

Draft revision identity is separate from Published version identity.

Native binary/build version is separate from Experience version.

## 6. Pages

A page is a declarative screen definition.

Conceptual shape:

```json
{
  "id": "home",
  "type": "page",
  "title": {"ar": "الرئيسية", "en": "Home"},
  "root": {
    "component": "layout.stack",
    "props": {},
    "children": []
  }
}
```

V1 page definitions reference registered component types only.

System-required pages may be marked required/locked by product policy outside merchant authority.

## 7. Component instances

Component Definition lives in Component Registry. App Schema stores configured **instances**.

Conceptual instance:

```json
{
  "id": "cmp_opaque",
  "component": "commerce.productGrid",
  "componentVersion": 1,
  "props": {},
  "bindings": {},
  "events": {},
  "conditions": [],
  "children": []
}
```

Rules:
- instance IDs are stable within the relevant version/revision;
- component type must exist in allowed registry;
- properties validate against component definition;
- children follow component child/content rules;
- unsupported component/version fails validation or uses an explicitly defined compatibility fallback;
- no runtime framework class names appear here.

## 8. Props

Props are merchant-configurable presentation/configuration values permitted by Component Definition.

Examples:
- heading text;
- image reference;
- spacing preset;
- card style;
- maximum visible item count;
- layout mode;
- accessibility label where merchant-provided content is required.

Props cannot override server business authority.

A local display label such as “ابتداءً من” is valid; an authoritative product price authored as a visual prop is not.

## 9. Commerce data bindings

Bindings point to **registered AWJ Data Resources**.

Conceptual example:

```json
{
  "bindings": {
    "items": {
      "resource": "commerce.products",
      "params": {
        "collection": {"source": "literal", "value": "featured"},
        "limit": {"source": "literal", "value": 8}
      }
    }
  }
}
```

The example is illustrative; final resource/parameter syntax belongs to `DATA_RESOURCE_REGISTRY_V1.md`.

Binding rules:
- resource must be allowlisted;
- parameters are typed/validated;
- runtime cannot supply authoritative tenant scope;
- backend applies tenant/customer/auth scope;
- pagination/loading/empty/error states are explicit;
- server response remains authoritative;
- no arbitrary URL/GraphQL/SQL binding in baseline V1.

## 10. Business-data examples

### Products

Schema:
```text
ProductGrid -> commerce.products resource
```

Runtime/backend:
```text
authenticated app/store context
 -> tenant-scoped published products
 -> prices
 -> media
 -> availability
 -> supported options/variants
```

### Categories

```text
CategoryList -> commerce.categories resource
```

Category publication/visibility remains controlled by AWJ Commerce.

### Cart

```text
AddToCart event -> commerce.cart.add registered action
Cart screen -> commerce.cart resource
```

Cart validation, eligibility, quantity, price and inventory checks remain server-authoritative.

### Checkout / Payment

Schema may configure supported presentation/entry points, but it cannot define payment logic.

```text
Checkout action
 -> trusted AWJ checkout capability
 -> server validation
 -> approved payment integration
```

No card/payment secret is persisted in App Schema.

### Customer / Orders

Account/order components bind to authenticated customer resources. Schema cannot request another customer's records by declaring an ID without backend authorization.

## 11. Events and Actions

Components emit allowlisted typed events.

Conceptual example:

```json
{
  "events": {
    "tap": {
      "action": "navigation.openProduct",
      "input": {
        "productId": {"source": "binding", "path": "item.id"}
      }
    }
  }
}
```

Exact syntax is deferred to `ACTION_REGISTRY_V1.md`.

Rules:
- action must exist in registry;
- input is typed;
- binding paths are constrained;
- sensitive actions re-authorize server-side;
- no arbitrary JavaScript/Dart callback;
- action result has typed success/error behavior;
- destructive/sensitive actions may require confirmation/idempotency.

## 12. State

V1 schema may refer to explicit state scopes:
- app/session UI state;
- page state;
- component/local state;
- immutable navigation parameters;
- server/query state.

State cannot become business authority.

Persisted state is opt-in and must use an approved runtime capability. Secrets are excluded from general schema state.

## 13. Conditions

Conditions are declarative predicates from an allowlisted language.

Candidate uses:
- signed-in status;
- resource non-empty;
- locale/market support;
- scheduled content window;
- safe UI-state comparison.

Conditions MUST NOT:
- grant authorization;
- override tenant;
- bypass payment/pricing/inventory rules;
- execute arbitrary code;
- make unrestricted network calls.

Exact expression syntax remains open.

## 14. Navigation

Navigation references registered page/route capabilities.

Conceptually:
- open page;
- open product;
- open category;
- open cart;
- open account;
- supported external/deep link under policy.

Incoming deep-link parameters remain untrusted and are validated/authorized before resource access.

## 15. Theme

Schema may contain app theme configuration and references to Shared Brand/Store Theme inheritance.

Theme contract should represent semantic AWJ concepts rather than framework tokens.

Conceptual areas:
- brand colors;
- typography roles;
- spacing/shape presets;
- surface/background roles;
- component variants.

Inherited/store-linked values and app overrides must remain distinguishable for Detect → Diff → Preview → Apply.

## 16. Localization and RTL

Schema supports Arabic and English as first-class locales.

Requirements:
- explicit default locale;
- localized merchant content;
- fallback policy;
- runtime direction derived correctly from locale;
- direction-aware layout properties;
- missing translation diagnostics.

Do not clone business data per locale when AWJ Commerce already provides localized fields.

## 17. Assets

Schema references managed assets; it should not embed secrets or unrestricted file paths.

Asset reference resolves through an authorized AWJ media/content capability.

Native bundled assets that require a binary rebuild are distinguished from remotely rendered experience assets.

## 18. Draft vs Published

Draft schema:
- editable;
- revisioned;
- accessible only through Builder/authorized Preview paths.

Published schema:
- immutable version;
- validated;
- compatibility checked;
- audit metadata attached;
- fetched by production runtime through Published Experience path.

Production runtime never gets Draft merely through a client query flag.

## 19. Runtime compatibility

Before Publish:
- validate schema version;
- validate every component/action/resource capability;
- determine minimum compatible runtime;
- classify Experience-only vs Native-release impact;
- prevent unsafe references for older installed runtimes.

Exact compatibility contract belongs to `RUNTIME_COMPATIBILITY_V1.md`.

## 20. Unknown or unsupported fields

Parser behavior must be version-aware.

Security-sensitive unknown action/resource/capability:
- fail closed.

Cosmetic optional property unknown to an older compatible runtime:
- use registry-defined safe fallback/ignore semantics only where contract explicitly permits it.

Never silently reinterpret unknown fields.

## 21. Validation stages

### Authoring validation
Fast feedback in Builder.

### Publish validation
Complete structural, semantic, compatibility and security validation.

### Runtime defensive validation
Runtime does not blindly trust a document merely because server previously validated it.

### Backend authorization
Every protected resource/action is independently authorized.

## 22. Error model

Schema/runtime should expose normalized safe error categories:
- invalid schema;
- incompatible runtime;
- unknown component;
- invalid prop;
- binding failure;
- unauthorized/forbidden;
- resource not found;
- network/retryable;
- action failure;
- safe fallback applied.

User-facing errors do not leak internal credentials or cross-tenant existence.

## 23. Observability

Correlate:
- app;
- experience version;
- runtime/binary version;
- page/component instance where useful;
- action/resource type;
- correlation/request ID;
- compatibility/fallback.

Redact:
- tokens;
- credentials;
- payment secrets;
- unnecessary PII.

## 24. Change impact

Schema diff feeds Publish Impact Classification.

Examples:
- banner text/image -> Experience-only candidate;
- reorder supported component -> Experience-only candidate;
- reference new component unavailable in installed runtime -> Native release required;
- new native SDK/capability -> outside pure schema; Native release required.

## 25. Explicit V1 exclusions

App Schema V1 does not support:
- arbitrary executable code;
- arbitrary merchant HTTP calls;
- arbitrary packages/plugins;
- direct SQL;
- merchant-controlled tenant switching;
- client-authoritative price/tax/payment/inventory;
- embedded signing/store credentials;
- unrestricted custom native components;
- general-purpose workflow scripting.

## 26. Required contract relationships

App Schema V1 depends on:
- `COMPONENT_REGISTRY_V1.md`
- `ACTION_REGISTRY_V1.md`
- `DATA_RESOURCE_REGISTRY_V1.md`
- `RUNTIME_COMPATIBILITY_V1.md`
- `PREVIEW_SESSION_SECURITY_V1.md`
- `APP_FACTORY_SECURITY_V1.md`
- `COMMERCE_MOBILE_API_READINESS.md`

Those contracts may refine field names but must preserve the security/source-of-truth boundaries in this document.

## 27. Open decisions

Before implementation lock:
- final serialization format and exact JSON field names;
- JSON Schema/OpenAPI/custom validator split;
- exact schema versioning syntax;
- exact condition/expression DSL;
- state persistence syntax;
- page/template inheritance;
- reusable section/component-instance references;
- asset reference format;
- navigation route syntax;
- compatibility negotiation fields;
- schema signing/hash requirements;
- size/complexity limits;
- migration strategy between schema versions.

## 28. Contract acceptance criteria

APP_SCHEMA_V1 can move from Draft to implementation contract only when:

1. Component/Action/Data registries can validate every referenced capability.
2. Tenant authority is impossible to grant through schema fields.
3. Commerce source-of-truth rule is preserved.
4. Draft/Published and Preview paths are explicit.
5. compatibility can classify older runtime behavior safely.
6. unknown security-sensitive capabilities fail closed.
7. representative Home → Product → Cart schema fixture validates.
8. Arabic/English + RTL/LTR fixture validates.
9. cross-tenant/security review finds no schema-controlled authorization path.
10. Flutter proof can render the framework-neutral fixture without leaking Flutter-specific concepts into the contract.
