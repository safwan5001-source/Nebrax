# DLV-INTEGRATIONS-UX-DESIGN-1 — Unified Integration Center (Delivery Platforms)

**Task:** `DLV-INTEGRATIONS-UX-DESIGN-1`
**Nature:** evidence-first UX and product specification. **Documentation only.** No application code, migration, API, permission, credential, Connect button, or financial behavior is added or changed.
**Repository:** `safwan5001-source/Nebrax`
**Base SHA (`origin/main` at start):** `71cf6396728bbc65ea0921a7afee25b3945e5189`
**Date:** 2026-10-13 (Asia/Riyadh)
**Companion:** `DLV-INTEGRATIONS-UX-DESIGN-1-HANDOFF.md`
**PRE_MERGE_REVIEW:** not stamped. A documentation-scope result belongs in the handoff after CI on the exact Head SHA.

> **Headline.** Today **no delivery platform is natively integrated**. Every platform is `OWNER_GATE` or `BLOCKED` for the technical connector (`DLV-PROVIDER-READINESS-1`). The Integration Center must therefore be built so that it can tell the truth about four *different* things (§3) and so that a working Connect button is **structurally impossible** until a provider passes the readiness gate (§4). Everything past catalog/readiness in this document is tagged `DESIGN_ONLY`, `GATED` or `DEFERRED` and ships nothing.

## 0. How to read this document

### 0.1 Tags

| Tag | Meaning |
|---|---|
| `EXISTS` | Verified in the repository at the base SHA (file cited). |
| `GAP-n` | A capability the design needs that does **not** exist (§1.3). Never invented. |
| `DESIGN_ONLY` | Specified for later; nothing may be built until its gate passes. |
| `GATED` | Buildable only after a named gate or Decision Packet is approved. |
| `DEFERRED` | Out of the first UX slices; no dependency chain started. |
| `DP-x` | Decision Packet (§10). The design needs a change to an existing security/financial contract; it is **documented, not implemented**. |

These mirror the vocabulary in `CLAUDE.md` (Commerce rule 10: unsupported capability is registered explicitly, never faked in the UI).

### 0.2 Evidence separation (Horizon protocol)

| Class | Where it appears |
|---|---|
| **External Evidence** | Only as already recorded and labeled in `DLV-PROVIDER-READINESS-1-REPORT.md` (PROVEN / KNOWN / UNKNOWN / NOT_FOUND / CONTRADICTORY). **This task performed no new provider research** and adds no new external claim. |
| **AWJ Decision** | §2, §3, §4, §5, §6, §7 and §9: UX and product decisions made here. Each is a proposal until the PR merges. |
| **Rejected / Not Adopted** | §11. |

Visual benchmarking (Horizon mandatory visual research for UI work) is addressed in §12.2: it is intentionally **not claimed** as done.

### 0.3 Hard boundaries kept by this task

No code, no migration, no route, no permission, no provider credential, no Connect button, no financial change, no refactor, no merge, no deploy. Where a decision would alter an existing financial or security contract it is a Decision Packet in §10.

---

## 1. Evidence baseline

### 1.1 What exists (`EXISTS`) and is reused

| Subsystem | Verified behavior | Source | Reuse in this design |
|---|---|---|---|
| **Delivery platform catalog** | Six fixed identity keys: `hungerstation`, `keeta`, `jahez`, `mrsool`, `ninja`, `the_chefz`. Identity only; no commission, tax, ledger or settlement. `GET /api/delivery-platforms/catalog`. | `app/Support/DeliveryPlatformCatalog.php`, `DeliveryPlatformController::catalog` | Source of the six catalog rows. |
| **Presentation registry** | Single map for AR/EN name, monogram, and the committed official App Store icon with per-file provenance. | `web/src/lib/delivery-platform-registry.ts`, `web/src/components/delivery/delivery-platform-mark.tsx` | Only source of platform name/mark. Supersedes the "logoSrc is null" wording in `DLV-HUB-UI-1` (PLATFORM-LOGOS-1 later committed the icons). |
| **Platform profiles (manual POS attribution)** | Tenant-owned profile per platform: collection mode, reference policy, versions, branch overrides, financial-role fields. UI status derived: `unconfigured` / `active` / `inactive`. Reads gated by `invoices.view` + `sales.pos`; saves by `company.manage`. The screen states "configured in AWJ, not an API connection". | `routes/api.php` (879-885), `web/src/lib/delivery-platform-management.ts`, `web/src/components/delivery-platforms/delivery-platforms-workspace.tsx`, `deliveryPlatforms.notAnIntegration` in `ar.json`/`en.json` | **Truth source for ladder step A.** Integration Center links to it; it does not replace or restyle it. |
| **POS platform attribution** | `GET /api/pos/delivery-platforms`; picker shows platform + external reference per policy. Platform-collected sales use the clearing path; merchant-collected use ordinary tender. | `web/src/components/pos/pos-delivery-platform-picker.tsx`, `DLV-POS-1-IMPLEMENTATION-REPORT.md` | Described, never modified. |
| **Delivery Hub** | Tenant+branch scoped operational projection. States `unrouted, received, accepted, preparing, ready, handed_off, cancelled_before_post`. Permanent identity `tenant + profile + provider_order_id`. No financial effect. `delivery_hub.view` / `delivery_hub.operate`. | `app/Models/DeliveryHubOrder.php`, `DLV-HUB-PROJECTION-1`, `DLV-HUB-UI-1`, `/delivery-hub` | Destination of every future synced order. Deep-link target. |
| **Delivery channel sales report** | Posted-invoice delivery totals from immutable `DeliveryInvoiceContext`; `reports.view`. | `web/src/app/(app)/reports/sales/delivery-channel/page.tsx`, `DLV-CHANNEL-REPORT-*` | Deep-link target; never altered. |
| **Connector Core (internal ingress)** | `DeliveryConnectorAccount` binds `(platform_key, external_store_id)` → tenant, profile, optional branch. Status **only** `configured` / `disabled`. Encrypted secret shown once. AWJ-HMAC verification (`X-AWJ-Signature`), 300 s window, replay/conflict handling, Hub projection only. The resource "does not return the secret or a provider connection state". | `app/Models/DeliveryConnectorAccount.php`, `DeliveryConnectorAccountService.php`, `DeliveryConnectorIngestionService.php`, `DeliveryConnectorAccountResource.php`, `DLV-CONNECTOR-CORE-1` | Backend vocabulary for the *internal* AWJ ingress. **Not** a provider connection. |
| **Connector ownership** | `configured_by` immutable; `operated_by` current actor; `POST …/reassign`; append-only `delivery_connector_operator_events`. | `DLV-CONNECTOR-OWNERSHIP-1-DECISION-PACKET.md` | Operator-reassignment UX (§6.7). |
| **Connector management API** | `GET/POST delivery-connectors`, `GET {id}`, `POST {id}/rotate-secret`, `POST {id}/disable`, `POST {id}/reassign`. Permissions `delivery_connector.view/manage/reassign` (owner/admin via `*`). Branch-restricted users see only accounts on their branches; unrouted accounts are hidden from them. | `routes/api.php` (895-900), `DeliveryConnectorAccountController.php`, `app/Support/Rbac.php` | Only management endpoints that exist. |
| **Provider readiness** | Evidence packet, not code. All six: technical `OWNER_GATE` (HungerStation, Keeta) or `BLOCKED` (Jahez, Mrsool, Ninja, The Chefz); imported-order posting `BLOCKED` for all. | `DLV-PROVIDER-READINESS-1-REPORT.md` | **Truth source for ladder step B** (via GAP-1). |
| **Settings navigation** | Sidebar group `settings` (reports, document design, numbering, taxes, payment methods, applications, account settings) inside super-group `admin`. Items carry optional `appKey` and `permission`. A separate `developer` group exists for API keys/webhooks. | `web/src/components/layout/sidebar.tsx` (314-343, 356) | Placement of the new entry (§9.1). |
| **UI primitives** | `Badge` (tones neutral/muted/positive/warning/negative), `Table`, `DataTable`, `Tabs`, `Dialog`, `Sheet`, `Select`, `Combobox`, `Skeleton`, `Toast`, `TechnicalDetails`, developer `SecretRevealDialog` / `ConfirmDialog`. | `web/src/components/ui/*`, `web/src/components/developer/*` | §9.9. |
| **Design system & i18n** | `DESIGN_SYSTEM.md`: dense accounting tool, one identity color, semantic green/red only for financial meaning, tables are the hero, explicit loading/empty/error states, tables→cards under `md`. `design-system/patterns/states.md`, `layout/responsive.md`, `accessibility/standards.md`. next-intl, RTL first. | repo root and `design-system/` | Rules applied throughout. |

### 1.2 What does **not** exist (so cannot be designed as if it did)

- No provider adapter, no OAuth/credential-exchange code, no provider API client, no outbound call to any delivery platform.
- No "Connected", "Live" or "Synced" value anywhere in the backend (`DLV-CONNECTOR-CORE-1`, "Authentication abstraction" and "Provider readiness").
- No readiness registry in code. Readiness exists only as prose in the evidence report.
- No web UI for connector accounts. (`grep` for `delivery-connectors` / `delivery_connector` in `web/src` returns nothing.)
- No read API for connector attempts, health, last-event time, or error history. The attempts table stores `outcome`, `http_status`, `error_code`, `secret_version`, `delivery_hub_order_id`, `provider_order_id` and an encrypted `operational_raw_body` (`hidden` on the model), but nothing lists them.
- No re-enable route for a disabled connector; no remap route; mapping columns are immutable and `(platform_key, external_store_id)` is globally unique (`DeliveryConnectorAccount::booted`, `delivery_connector_store_unique`).
- No audit record for rotate or disable. Only operator reassignment writes an append-only event.

### 1.3 Gap register

| ID | Gap | Needed by | Resolution path |
|---|---|---|---|
| **GAP-1** | Provider readiness not machine-readable; no server-side gate | Catalog, state derivation, Connect gating | Task `INT-READY-1` (§11). Additive, no tenant data. |
| **GAP-2** | No read API for connector attempts / activity | Activity & error history (screen 8), health (screen 6) | Task `INT-ACT-1`. Additive, sanitized. |
| **GAP-3** | No audit trail for connection lifecycle (create, rotate, disable, connect, disconnect) | "Auditable connection changes" | `DP-F`, then `INT-AUDIT-1`. **Ingress create / rotate / disable closed by `INT-AUDIT-1` (2026-10-14)**; connect/disconnect events remain future (Track P). |
| **GAP-4** | No re-enable / reconnect path for a disabled mapping | Disconnect → reconnect | `DP-A`. |
| **GAP-5** | Store→branch mapping is immutable and the store id is permanently reserved | Screen 5 "change mapping" | `DP-A`. |
| **GAP-6** | No health data model (token expiry, last success, last failure) | Screen 6 | `DP-B`, after a provider is READY. |
| **GAP-7** | No place to store provider-issued tokens/refresh tokens; DG-7 (vault vs app-key encryption) still open | Authorization, reauth | `DP-B`. |
| **GAP-8** | No uniqueness rule on the *provider merchant account* across tenants (only on store id) | "No cross-tenant connection reuse" | `DP-D`. |
| **GAP-9** | Hub rows carry no "source" (manual vs connector) | Activity tab, Hub badge | `INT-ACT-1` (derive via attempts link). |

---

## 2. Product architecture

### 2.1 Positioning

`Settings → Integrations` is a **navigation and truth layer over subsystems that already work**. It does not become a second owner of platform profiles, Hub orders, POS attribution or reports. Those stay where they are (`/delivery-platforms`, `/delivery-hub`, POS, `/reports/sales/delivery-channel`). The Center adds: one place to see what each platform can and cannot do, an honest readiness model, and (later, gated) the connection lifecycle.

**Decision AD-1.** Reuse, do not absorb. Moving profile management into the Center would redesign a functioning subsystem and risk the manual attribution path (Strict Boundary: preserve current manual POS attribution and reports). Rejected in §11.

### 2.2 Categories

| Category | Status in this design | What the landing shows |
|---|---|---|
| **Delivery Platforms** | In scope, detailed (§5-§8). | Active card with the capability ladder summary. |
| E-commerce | Future. | Non-interactive "Planned" line. |
| Payment Gateways | Future. | Non-interactive "Planned" line. (A `PaymentGateway` model exists in the backend but is **not** an integration claim here; payment gateways are out of scope and must not be surfaced as available.) |
| Shipping Providers | Future. | Non-interactive "Planned" line. |

Scope clarification: these planned categories mean **integrations with external third-party platforms or providers**. AWJ's own native modules (the Commerce workspace/storefront, payment methods, and internal payment-gateway accounting services) are not integrations in this sense and are neither listed nor described by the Center.

**Rule R-CAT.** A future category renders as plain text in a muted "Planned categories" list: no link, no button, no status dot, no count, not focusable. Copy states plainly that nothing is available there. No future category may appear in the sidebar or in route config.

### 2.3 Information architecture

```
Settings
└── Integrations                              /integrations
    ├── Delivery platforms (category)         /integrations/delivery-platforms
    │   └── Provider (6)                      /integrations/delivery-platforms/[platformKey]
    │       ├── Overview        (default)     ?tab=overview     EXISTS-backed
    │       ├── Stores & branches             ?tab=stores       GATED   (screens 4, 5)
    │       ├── Connection health             ?tab=health       GATED   (screens 6, 7)
    │       └── Activity & errors             ?tab=activity     GATED   (screen 8)
    ├── (E-commerce / Payment gateways / Shipping)  — planned text only, no routes
    └── cross-links (existing, unchanged)
        ├── /delivery-platforms   manual POS attribution setup
        ├── /delivery-hub         operational orders
        └── /reports/sales/delivery-channel
```

- `[platformKey]` is validated against `DeliveryPlatformCatalog` keys; an unknown key is a 404 page, never an empty provider shell.
- Tabs `stores`, `health`, `activity` are **not rendered** while the provider's UX state is `NOT_SUPPORTED` or `AWAITING_PROVIDER_APPROVAL` (nothing to show; showing empty tabs would imply a connection can exist). For these providers the tab strip contains `Overview` only.
- `/integrations/delivery-platforms/[platformKey]/connect` **does not exist as a route** until the gate passes (`DESIGN_ONLY`, §6.4).

### 2.4 Route and permission summary

| Route | Minimum gate (all existing) |
|---|---|
| `/integrations` | Authenticated tenant user. Per-category availability decides content (below). |
| `/integrations/delivery-platforms` and provider Overview | `invoices.view` **and** application `sales.pos` enabled (mirrors `/delivery-platforms`). |
| Tab `stores`, `health`, `activity` (future) | `delivery_connector.view` (owner/admin) plus the same app gate and the branch rules in §7. |
| Any state-changing connection action (future) | `delivery_connector.manage` (reassign: `delivery_connector.reassign`). **No new permission** (see `DP-E`). |

---

## 3. The four-step capability ladder (A / B / C / D)

The single most important rule of this design: **the UI never collapses these into one badge, one color, or one word.** They are four independent facts with four independent sources.

| Step | Fact | Scope of the fact | Source of truth | Today |
|---|---|---|---|---|
| **A** | Platform configured for **manual POS attribution** | Per tenant | `DeliveryPlatformProfile` (`GET /api/delivery-platforms`, row status `active`) | Varies per tenant. |
| **B** | **Native integration technically available and officially approved** | Per platform, identical for all tenants | Readiness manifest (GAP-1), derived from `DLV-PROVIDER-READINESS-1` | **False for all six.** |
| **C** | **Connected merchant account with verified credentials** | Per tenant × platform × merchant account | Future connection record (GAP-6/7) | **Impossible** (requires B). |
| **D** | **Active operational order synchronization** | Per connection × store | Future connection + sync record | **Impossible** (requires C). |

Dependencies are strict and one-way: `D ⇒ C ⇒ B`. `A` is independent of `B/C/D` and stays valid forever (manual attribution never depends on an integration).

### 3.1 Presentation: the ladder component

Each provider shows four rows, always in this order, always all four (a missing step is stated, not hidden):

| Row | EN label | AR label | Allowed values (EN / AR) |
|---|---|---|---|
| A | Manual POS attribution | الإسناد اليدوي في نقطة البيع | Not set up / غير مهيأة · Set up / مهيأة · Disabled / معطّلة |
| B | Native integration | التكامل الأصلي | Not available / غير متاح · Pending agreement / بانتظار الاتفاق · Available / متاح |
| C | Merchant account | حساب التاجر | Not connected / غير متصل · Connected / متصل · Needs attention / يحتاج إجراء |
| D | Order synchronization | مزامنة الطلبات | Off / متوقفة · Active / نشطة · Paused / متوقفة مؤقتاً |

- Each value is an icon + text. Color is secondary.
- **R-LADDER-1.** Rows C and D render the literal text "Unavailable until a native integration exists" / «غير متاح قبل توفر تكامل أصلي» whenever B is not `Available`. They never show "0 connected", a zero count, a gray dot that could read as "healthy", or an empty progress bar.
- **R-LADDER-2.** `B = Available` requires manifest `connectEnabled = true` (§4). A READY technical status alone is not enough.
- **R-LADDER-3.** The word "Connected" appears only for row C and only when a verified-credential record exists. The existing backend status `configured` must never be labeled "Connected", "Live" or "Synced" (§5.3).

### 3.2 Today's catalog (derived from the evidence packet)

| Platform | A (per tenant) | B | Reason shown to the tenant (EN / AR) | Evidence class (internal) |
|---|---|---|---|---|
| HungerStation / هنقرستيشن | tenant value | Pending agreement | "Integration requires an agreement and test access from the platform." / «يتطلب التكامل اتفاقاً ووصولاً تجريبياً من المنصة.» | Technical `OWNER_GATE`. Three public surfaces not proven to be one API; AWJ holds no agreement, credentials or test vendor. |
| Keeta / كيتا | tenant value | Pending agreement | same | Technical `OWNER_GATE`. Most complete public protocol; no NDA/test store held; KSA applicability not stated; two webhook-registration guides conflict. |
| Jahez / جاهز | tenant value | Not available | "No integration with this platform is available in AWJ yet." / «لا يتوفر تكامل مع هذه المنصة في أَوْج بعد.» | Technical `BLOCKED`. No official order-API contract found. |
| Mrsool / مرسول | tenant value | Not available | same | Technical `BLOCKED`. |
| Ninja / نينجا | tenant value | Not available | same | Technical `BLOCKED`. |
| The Chefz / ذا شيفز | tenant value | Not available | same | Technical `BLOCKED`. |

**R-COPY-1 (accuracy).** "Not available" copy says *AWJ has no integration for it*. It must **not** say the platform has no API or does not support integrations: the evidence is `NOT_FOUND` on public pages read, and a private contract is `UNKNOWN`, not disproven.
**R-COPY-2.** "Pending agreement" must not imply that AWJ has submitted an application or that approval is in progress. The evidence packet records only an owner action gate.
**R-COPY-3.** Never display "official partner", a partnership badge, or a "coming soon" date. Logos identify the platform only.

---

## 4. Provider readiness gating

### 4.1 Gate definition

The documented basis is `DLV-PROVIDER-READINESS-1` §7-§9 and Horizon "Native provider tasks" (official contract, onboarding/credential status, sandbox, event semantics, authentication/signature rules, retry/idempotency, cancellation/refund behavior, capability gaps). A provider passes the **Connect gate** only when **all** of the following are recorded as evidence in the repository:

| # | Condition | Basis |
|---|---|---|
| G1 | Official API/partner contract identified; frozen spec version whose **authentication section AWJ has actually read**. | Readiness §7, Horizon native-provider list |
| G2 | Named AWJ merchant agreement (and NDA where the provider requires one) signed. | Readiness §7 |
| G3 | A test path AWJ **holds**: sandbox/test vendor plus non-production credentials issued to AWJ. | Readiness §9 |
| G4 | Event/status semantics, retry/idempotency expectations, cancellation/refund behavior and capability gaps written down. | Horizon |
| G5 | Store-identity key rule written (which provider id maps to `external_store_id`). | Readiness §5 "Store identity" |
| G6 | Written limit that the first slice is **operational Hub projection only**. | Readiness §7 |
| G7 | Adapter implemented and verified against the test path; provider authentication terminates in the backend and produces the neutral envelope (HMAC alone is not a provider signature). | Readiness §5 |
| G8 | Decision on storage of provider-issued secrets/tokens (DG-7 vault vs. accepted app-key encryption). | Core report, Readiness §10 |
| G9 | Explicit owner release decision (the change that flips the manifest). | **AWJ Decision** (this doc); Merge ≠ Deploy |

G1-G6 are documented requirements; G7-G9 are this design's proposed completion of the gate. Financial posting readiness (`DG-3-PROVIDER-READINESS`) is **not** part of this gate: Hub-only synchronization never posts. The UI says so (§6.4, copy `hubOnlyNote`).

### 4.2 Machine-readable manifest (`GAP-1`, proposed, not created here)

A single backend-owned constant (same family as `DeliveryPlatformCatalog`), no database, no tenant editing, changed only by a reviewed PR that cites evidence:

```
platform_key
technical        READY | BLOCKED | OWNER_GATE      (vocabulary of the evidence report)
evidence_ref     repo path of the frozen evidence packet
evidence_date    ISO date of the last verification
auth_method      null | declared by the adapter once G1 is met
connect_enabled  bool   — false for all six today
sync_enabled     bool   — false for all six today (separate kill switch)
```

Derived provider-level UX state:

| Condition | UX state |
|---|---|
| `technical = BLOCKED` | `NOT_SUPPORTED` |
| `technical = OWNER_GATE` | `AWAITING_PROVIDER_APPROVAL` |
| `technical = READY` and `connect_enabled = false` | `AWAITING_PROVIDER_APPROVAL` |
| `technical = READY` and `connect_enabled = true` | `READY_TO_CONNECT` |

`sync_enabled` is a separate kill switch so a provider can be stopped without deleting tenant connections (the Delivery Hero page records that integrations "might be disabled" when the implementation contract is not fulfilled).

### 4.3 Rules (non-negotiable)

- **R-GATE-1.** Without `connect_enabled = true`, **no Connect/Authorize/Link control exists in the DOM**. It is not disabled, grayed out, hidden by CSS, or behind a feature flag in the browser. The component is not rendered.
- **R-GATE-2.** The gate is enforced **server-side first**. Any future authorization endpoint must reject with `409 provider_not_ready` when the manifest says no, regardless of what the client sent. The UI is a courtesy, not the control.
- **R-GATE-3.** The manifest is not tenant-controlled, not overridable by `Settings`/`BranchSettings` (Rule 6 of `CLAUDE.md` does not apply: this is a safety/evidence gate, not a business policy with several valid answers).
- **R-GATE-4.** Flipping `connect_enabled` for a provider is its own PR with the evidence appendix and a test that the provider's adapter passes the test path. Mixed PRs (UI + manifest flip) are rejected.
- **R-GATE-5 (invariant test).** A permanent test enumerates all manifest rows and asserts: every row with `connect_enabled = false` renders no element matching Connect/Authorize/Link (role button or link) on the provider page, in both locales.
- **R-GATE-6.** Today's six rows must all be `connect_enabled = false` in the first PR that introduces the manifest.
- **R-GATE-7 (vocabulary).** The invariant test (R-GATE-5) forbids connection verbs — Connect, Link, Authorize, Integrate, Enable integration, Start sync, Reconnect — on any provider whose `connect_enabled` is false, including **Reconnect** on `DISCONNECTED` after a manifest revocation. Controls for the AWJ-signed ingress (DP-C) are a different capability: they must be titled "AWJ-signed ingress", sit in the collapsed Advanced section, be owner/admin only, and never use connection verbs or appear as a provider's primary action.

---

## 5. Screen-by-screen specification

Conventions for all screens:

- RTL first; layout uses logical properties only (`ps/pe/ms/me/start/end`, `text-start`), no `left/right`. English mirrors automatically (`dir="ltr"` on the document).
- Identifiers (store ids, event ids, checksums, order ids, secret prefixes) render inside `dir="ltr"` spans, monospace (`num` class), with `unicode-bidi: isolate`. They are never translated.
- Dates and times go through the existing display formatter (as in Hub UI), timezone Asia/Riyadh.
- Page container follows existing pages: heading `text-xl font-semibold`, subtitle `text-sm text-muted`, `space-y-4`, `pb-16 md:pb-0` for the mobile bottom bar.
- Status badges: icon + text; tones per §5.0.
- Every data region has loading (Skeleton), empty (message + next step), and error (message + retry) per `design-system/patterns/states.md`.

### 5.0 Badge tone map

`DESIGN_SYSTEM.md` reserves semantic green/red for financial meaning. Integration status is not a financial fact, so:

| Meaning | Tone | Icon | Used for |
|---|---|---|---|
| Informational / healthy-by-evidence | `neutral` | check | Set up (A), Connected (C), Sync active (D) |
| Not available / awaiting / off | `muted` | minus / clock | NOT_SUPPORTED, AWAITING_PROVIDER_APPROVAL, Disconnected, Off |
| Needs attention | `warning` | alert-triangle | SYNC_PAUSED, REAUTH_REQUIRED |
| Failure | `negative` | x-circle | CONNECTION_ERROR |

Step A "Set up/Enabled" may keep the existing `/delivery-platforms` badge tone (`positive`) for visual continuity on that screen only; the Center uses the table above. (Minor deviation noted so reviewers can choose one.)

### 5.1 Screen 1 — Integration Center landing (`/integrations`)

**Purpose.** One orientation page. Honest about what exists.
**Data.** `GET /api/delivery-platforms` (for A), the manifest (GAP-1), `GET /applications/nav-state` (already used by the sidebar).
**Desktop layout.** Header (title, one-line subtitle) → one **category card** for Delivery Platforms (full width, dense) → muted "Planned categories" list.

Delivery Platforms card content:

- Title, one-sentence description.
- Summary strip (three facts, text not charts):
  - "{n} of 6 platforms set up for POS attribution" / «{n} من 6 منصات مهيأة للإسناد في نقطة البيع».
  - "Native integrations: none available yet" / «التكاملات الأصلية: لا يوجد متاح حالياً». When ≥1 provider has `B = Available`, this line becomes "{k} available"; and only then C/D counters appear (R-LADDER-1).
- Primary action: **Open delivery platforms**. Secondary links: Delivery Hub (if `delivery_hub.view`), Delivery channel report (if `reports.view`).
- No illustrations, gradients, or promotional text.

**Mobile.** Single column; the card's strip stacks; links become full-width list rows (min 44 px).

| State | Behavior |
|---|---|
| Loading | Skeleton card (same height). |
| Empty | Not applicable (the card always exists). If the user lacks `invoices.view`, see permission-denied. |
| Permission denied | Card replaced by: «ليست لديك صلاحية عرض منصات التوصيل. اطلب من المالك أو المدير.» / "You do not have permission to view delivery platforms. Ask an owner or admin." No data request is made (same fail-closed pattern as Hub UI). |
| Unavailable | If `sales.pos` is disabled/suspended: «تطبيق نقاط البيع غير مفعّل لهذه المؤسسة.» + link to `/applications` only if the user can reach it. |
| Error | Inline message + **Try again**. |

### 5.2 Screen 2 — Delivery platform catalog (`/integrations/delivery-platforms`)

**Purpose.** Compare the six platforms on the four ladder steps at a glance.
**Data.** Same as screen 1 plus the catalog.
**Desktop (`md+`).** A compact table (the hero is the table). Fixed row order = registry order (HungerStation, Jahez, Mrsool, Keeta, Ninja, The Chefz) in both locales; no ranking, "recommended", or "popular" markers.

| Column | Content |
|---|---|
| Platform | `DeliveryPlatformMark` + localized name (link to provider page). |
| Manual POS (A) | Badge. |
| Native integration (B) | Badge + short reason on hover/focus and in the row's detail line. |
| Merchant account (C) | Badge, or "—" with `aria-label` "Unavailable until a native integration exists" when B ≠ Available. |
| Order sync (D) | Same rule as C. |
| Action | "View details" link. |

No Connect action column exists today (R-GATE-1).

**Mobile (`< md`).** Cards, one per platform: mark+name header, four labeled ladder rows stacked, a single "View details" row. This follows the existing table→cards pattern (`responsive.md` §1), and the existing `/delivery-platforms` screen already renders a mobile list.

| State | Behavior |
|---|---|
| Loading | Skeleton rows ×6. |
| Empty | Never empty: the six catalog rows always render; if the profiles call fails but the catalog loads, A shows "Could not load" for all and a retry banner (B/C/D remain truthful because they do not depend on it). |
| Permission denied / unavailable | As screen 1. |
| Error | Banner `role="alert"` + retry; rows stay visible with A unknown. |

### 5.3 Screen 3 — Provider details (`/integrations/delivery-platforms/[platformKey]`)

**Layout.** Header (mark, localized name, derived UX state badge) → ladder (full, with the "what this means" sentence under each row) → three blocks.

1. **What works today in AWJ** (always shown, `EXISTS`-backed):
   - Record the platform on POS delivery sales (links to `/delivery-platforms` for setup, and states the tenant's A value).
   - Enter and manage delivery orders manually in the Delivery Hub (link; shown only with `delivery_hub.view`).
   - See delivery-channel sales in the report (link; only with `reports.view`).
2. **What native integration would require** (tenant-friendly checklist, text only, sourced from the manifest): "An agreement with the platform", "Test access issued to AWJ", "An approved technical specification". Items show *Not yet available*; no dates, no promises (R-COPY-2/3).
3. **Important boundaries** (static text, both locales):
   - "Orders that arrive through a future integration appear in the Delivery Hub as operational records. They do not create invoices, payments, VAT, commission or settlement." / «الطلبات الواردة عبر أي تكامل مستقبلي تظهر في صندوق التوصيل كسجلات تشغيلية. لا تنشئ فواتير ولا مدفوعات ولا ضريبة ولا عمولة ولا تسوية.»
   - "Manual POS attribution and reports are unchanged." / «الإسناد اليدوي في نقطة البيع والتقارير لا يتغيران.»

**Advanced (collapsed `TechnicalDetails`, owner/admin only):** manifest `technical` value, evidence date, evidence reference. For platform operators, not for merchants.

**Internal ingress (`GATED` by `DP-C`).** If `DP-C` is approved, a read-only "AWJ signed ingress" panel lists the tenant's `DeliveryConnectorAccount` rows for this platform (store id, branch, status, secret prefix, version, operator). *(Approved for `INT-UX-4` on 2026-10-13 within the limits recorded under `DP-C`; the displayed fields there supersede this list — no secret prefix, no operator.)* It is titled **"AWJ-signed event ingress — not a connection to {platform}"** / «استقبال أحداث موقّعة من أَوْج — ليس ربطاً مع {platform}». It must never reuse the words Connected/Live/Synced.

**Tabs.** `Overview` only while the provider is `NOT_SUPPORTED` / `AWAITING_PROVIDER_APPROVAL` (see §2.3). Other tabs appear only for `READY_TO_CONNECT` and later states.

| State | Behavior |
|---|---|
| Loading | Header skeleton + ladder skeleton. |
| Unknown key | 404 page with link back to the catalog. |
| Error | Alert + retry; the static boundary text still renders. |
| Permission denied | As screen 1. |

### 5.4 Screen 4 — Merchant account connection workflow (`DESIGN_ONLY`, `GATED`)

**Not built, not routed, not rendered** until a provider has `connect_enabled = true` (R-GATE-1) *and* `DP-B` (token storage/state persistence) is approved. This section fixes the behavior so the first adapter task cannot improvise.

**Preconditions (checked server-side, shown as a checklist at step 1):**
`sales.pos` enabled · subscription active · caller has `delivery_connector.manage` · branch scope sufficient (restricted users cannot connect an unrouted account) · the provider's `connect_enabled` · no existing active connection for this tenant×platform×merchant account · an eligible active operator exists (`actor()` rules from the ownership packet).

**Steps (wizard, one decision per step, resumable):**

| # | Step | Behavior |
|---|---|---|
| 1 | **Before you start** | Plain-language scope: what will be read, Hub-only, no accounting. Checklist from preconditions. No credential field yet. |
| 2 | **Authorize** | Method is declared by the adapter (`oauth_redirect`, `credential_exchange`, or `partner_issued`); the UI renders only what the declared method needs. Credential inputs are `type="password"`, `autocomplete="off"`, never persisted client-side. For redirects, the `state` parameter is bound to tenant+user server-side. |
| 3 | **Verify merchant identity** | The *provider-returned* merchant name / registration / store list is shown as **untrusted text** (escaped, truncated, `dir="auto"`). The user must tick an explicit confirmation "This is my merchant account". If the provider returns a CR or VAT number and it disagrees with the tenant's, the flow **stops** (hard error, no override). Identity is never inferred from a typed id. |
| 4 | **Stores** | Provider stores are fetched and listed; continue to mapping (screen 5). |
| 5 | **Review** | Summary of merchant, stores→branches, operator. Result state is `CONNECTED` with sync **off**. |
| 6 | **Start synchronization** (separate, explicit action) | Confirms "Orders will appear in the Delivery Hub only." Moves `CONNECTED → SYNC_ACTIVE`. Connecting and syncing are two decisions. |

**Failure handling.** Denied, cancelled or expired authorization returns to `READY_TO_CONNECT` with the reason; no credential or partial connection is kept. A provider-side identity mismatch is final for that attempt.

**Success message.** «تم توثيق حساب التاجر. لم تبدأ مزامنة الطلبات بعد.» / "Merchant account verified. Order synchronization has not started yet." (Never "Connected successfully, orders are syncing".)

### 5.5 Screen 5 — External store → AWJ branch mapping (`GATED`)

**Data model reality (`EXISTS`).** A mapping is `(platform_key, external_store_id) → tenant + profile + branch|null`. The three mapping columns and the profile are **immutable after create**; the pair is **globally unique**; disabling does not release the store id (`DeliveryConnectorAccount::booted`, `delivery_connector_store_unique`). `GAP-4/5`: there is no remap and no re-enable.

**Therefore this screen is designed as create-once.**

Desktop: a table, one row per provider store.

| Column | Content |
|---|---|
| Provider store | Provider-returned name (untrusted text) + external id (`dir="ltr"`, mono). |
| Branch | `Select`/`Combobox` of branches the actor may access; active branches only (a branch-restricted user cannot choose "Unrouted"; unrestricted may choose "Unrouted — central queue", matching the Core's accepted unrouted state). |
| Status | `Unmapped` · `Verified` · `Conflict` · `Paused` (UX sub-status, not an enum). |
| Operator | `operated_by` user (read-only here; change via screen 7). |

Rules:

- **R-MAP-1.** Save is an explicit confirmation: «لا يمكن تغيير الفرع بعد الحفظ.» / "The branch cannot be changed after saving." The control states the consequence before commit.
- **R-MAP-2.** `mapping_ambiguous` (store already mapped) is shown generically: «معرّف المتجر مربوط مسبقاً ولا يمكن إعادة استخدامه. إن كان متجرك فتواصل مع الدعم.» The UI never says *which* tenant, and offers no "claim" action (the global-uniqueness oracle is intentional and must not leak more).
- **R-MAP-3.** Provider-asserted `tenant_id`/`branch_id` are never used to choose the destination; the branch comes only from the user's selection (Core: "Destination branch … is not taken from the payload").
- **R-MAP-4.** A restricted user sees and edits only stores mapped to branches they can access; unrouted accounts are hidden from them (Core: `visibleTo`).
- **R-MAP-5.** "Change branch / re-home a store" is **not offered**. Copy under the row: «لنقل المتجر إلى فرع آخر تواصل مع الدعم.» until `DP-A` is decided.

**Mobile.** Cards per store with the branch select as a full-width control; confirmation as a bottom `Sheet`.

| State | Behavior |
|---|---|
| Empty | «لم يُرجِع المزوّد أي متجر لهذا الحساب.» + **Refresh stores** (re-reads, no side effect). |
| Loading | Skeleton rows. |
| Error | Per-row error, bulk retry. |
| No eligible branch | «لا توجد فروع متاحة لك.» (restricted user with none) |

### 5.6 Screen 6 — Connection health and synchronization status (`GATED`)

**Principle.** Show **evidence with timestamps**, not adjectives. The Core deliberately has no Connected/Live/Synced status; a health screen that says "Healthy ✓" without evidence would reintroduce it.

**Panel A — Connection (provider-level fields; `DP-B`).** Merchant name (untrusted text), authorization date, credentials last verified at, token validity window if the provider has one, last refresh result. Never the token or its prefix.

**Panel B — Synchronization (derivable once `INT-ACT-1` exists).** Last event received (timestamp, relative), last accepted, last failure with its error code, counts for the last 24 h by outcome (`accepted`, replayed, conflict, rejected), number of Hub orders still `unrouted`, current gates: application state, subscription state, operator eligibility (these three map to existing per-event rejections `application_inactive`, `subscription_inactive`, `actor_unavailable`).

**Panel C — Operational owner.** Current operator, creator (history), reassign action (screen 7).

**Status wording rules.**

| Observation | Text (EN / AR) |
|---|---|
| Event received within expected window | "Last event 2 min ago" / «آخر حدث قبل دقيقتين» |
| No events yet | "No events received yet" / «لم يصل أي حدث بعد» (not "Healthy") |
| Silence beyond the expected window | "No events for {n} h" / «لا أحداث منذ {n} ساعة» + info that silence can be normal (no orders) — never an error by itself |
| Failures | Error code + localized message from the dictionary (Appendix C) |

`SYNC_ACTIVE` is shown only when the adapter has produced proof of operation (heartbeat or polling success) within a provider-specific window; otherwise the state is `SYNC_ACTIVE` with a "No recent confirmation" warning line, not silently green.

Refresh: manual **Refresh** plus a polling interval no shorter than 30 s while the tab is visible; stops when hidden. `aria-live="polite"` on the "last updated" text only.

| State | Behavior |
|---|---|
| Loading | Skeleton panels. |
| Empty | "No events received yet" panel with next-step text. |
| Error | «تعذّر تحميل حالة الربط.» + retry; the last known values are shown with their timestamp, marked stale. |
| Permission denied | As §5.1; branch-restricted users only see connections on their branches. |

### 5.7 Screen 7 — Reauthorization, disconnection, credential and ownership actions (`GATED`, partly `EXISTS`)

Actions (each opens a `Dialog`; destructive ones use the existing `ConfirmDialog` pattern):

| Action | Backend | Gate | Behavior |
|---|---|---|---|
| **Reauthorize** | `DESIGN_ONLY` | `delivery_connector.manage` | Same method as step 2 of §5.4. Replaces credentials atomically; old ones are invalid immediately. **Identity must match** the original merchant; otherwise stop and require disconnect + new connection (never silently rebind a store mapping to a different merchant). Mappings and Hub history are preserved. Returns to `SYNC_PAUSED` (if sync had been active) or `CONNECTED`; the user presses Resume. |
| **Pause / Resume sync** | `DESIGN_ONLY` | `delivery_connector.manage` | `SYNC_ACTIVE ⇄ SYNC_PAUSED`. Does not delete orders; events arriving while paused are not acknowledged as applied. |
| **Rotate AWJ ingress secret** | `EXISTS` (`POST …/rotate-secret`) | `delivery_connector.manage` | Shows the new secret **once** in a reveal dialog (reuse `SecretRevealDialog`, §5.9); previous secret invalid immediately; explains that the secret is for the AWJ-signed ingress only. |
| **Reassign operator** | `EXISTS` (`POST …/reassign`) | `delivery_connector.reassign` | Pick an active, same-tenant user eligible for the branch (an unrouted connector accepts only a user without branch restriction). Result copy includes: "Reassigning does not change the secret. If the previous operator may still hold it, rotate it separately." / «إعادة الإسناد لا تغيّر السر. إن كان المشغّل السابق يملكه فدوّره على حدة.» Errors map `operator_ineligible`. |
| **Disconnect** | `DESIGN_ONLY` for provider connections; `disable` `EXISTS` for ingress | `delivery_connector.manage` | See safe disconnect below. |

**Safe disconnect sequence (design).**

1. **Impact preview** (read-only): mapped stores, Hub orders not yet terminal (`received…handed_off`), what is kept (all Hub orders, attempts, audit), what is removed (credentials).
2. **Confirmation** with optional reason; typed confirmation of the store/merchant name for connections with active sync.
3. **Fail-closed first:** stop synchronization (`→ SYNC_PAUSED/disabled`) *before* touching credentials.
4. **Revoke at the provider** only where the provider's revocation method is documented and verified in the adapter evidence; otherwise state it plainly: «سُحبت الصلاحيات محلياً. يلزم إلغاء التفويض من بوابة {platform}.» ("Credentials were removed locally. Revoke authorization in the {platform} portal.") The UI never claims a provider-side revoke it did not perform.
5. **Purge local secrets** (tokens/credentials zeroed), keep non-secret metadata for audit.
6. **Audit event** (§7.4). Partial failure still ends in `DISCONNECTED` with a visible "Revocation not confirmed" flag requiring user action.
7. Reconnecting is a **new authorization**; whether the old store mapping can be reattached is `DP-A`.

For the existing ingress, `disable` flips `status` to `disabled`, records `disabled_at`, **does not** release the store id and **cannot be undone** through the API today (`GAP-4`). The dialog must say so before confirming: «لا يمكن إعادة التفعيل من هنا حالياً.»

### 5.8 Screen 8 — Integration activity and error history (`GATED`; needs `INT-ACT-1`)

**Two logs, never merged:**

1. **Events** (from connector attempts): time, short event id, outcome, error code (+ localized message), provider order reference, link to the Hub order, secret version. **Never** the raw body (it is encrypted and `hidden`; a "view payload" action is explicitly out of scope).
2. **Configuration changes** (audit; **reader owned by `INT-UX-6`, deferred until the DP-E read permission is approved**): who, when, what. **Populated today** (by `INT-AUDIT-1`, merged): `ingress.created`, `secret.rotated`, `ingress.disabled` in `delivery_connector_lifecycle_events`, plus operator reassignment in the separate `delivery_connector_operator_events`. **Not populated — still need future writers (Track P):** connect, authorize, reauthorize, map, pause/resume, disconnect. Screen 8 must not present the log as complete while those writers do not exist.

**Desktop.** `DataTable` with server pagination and sort (`serverSort`), filters: outcome, error code, date range, store. Row opens a `Sheet` with details inside `TechnicalDetails` (ids, checksums, `http_status`).
**Mobile.** Cards; filters in a `Sheet`.

| State | Behavior |
|---|---|
| Empty | «لا توجد أحداث بعد.» / "No events yet." |
| Loading | Table skeleton. |
| Error | Retry. |
| Permission denied | `delivery_connector.view` required; same fail-closed behavior. |

Errors are always shown with a stable code and the localized text from Appendix C; raw server text is not rendered. Replays (`outcome: replay`) are labeled as replays, not as failures. `state_not_applied` is labeled "Event received; order state unchanged" (HTTP 200 by design), not as an error.

### 5.9 Screen 9 — Cross-cutting states

| Condition | Where | Treatment |
|---|---|---|
| **Loading** | All | Skeleton shaped like the content; no blocking spinner. |
| **Empty** | Lists | Message + the single next action; never an empty table with headers only. |
| **Permission denied** | Page/tab/action | No request is issued for data the user cannot view. Page: explanatory message with who to ask. Action: the control is **absent**, not disabled with a tooltip (consistent with Hub UI "read-only view renders no actions"). Server remains the authority (403/404). |
| **Foreign/branch-hidden resource** | Detail routes | Same as not found (404 page); never "exists but forbidden". |
| **Unavailable — application off** | Delivery category | Informational block, no error styling. |
| **Unavailable — subscription inactive** | Delivery category | Informational block; actions absent. |
| **Unavailable — provider not ready** | Provider page | Not an error. Ladder states B accurately. |
| **Fetch failure** | Any region | `role="alert"` message + retry; previous data kept and marked stale when available. |
| **Offline** | All | Message; no queued mutations. |
| **Session expired (401)** | All | Existing global redirect to `/login`. |

---

## 6. Connection state machine

These are **proposed UX states**. They are not permission to add database enums; persistence is `DP-B`.

### 6.1 States

Two scopes exist and must not be mixed:

- **Provider-level** (same for all tenants, derived from the manifest): `NOT_SUPPORTED`, `AWAITING_PROVIDER_APPROVAL`, `READY_TO_CONNECT`.
- **Connection-level** (per tenant × platform × merchant account): `AUTHORIZATION_PENDING`, `CONNECTED`, `SYNC_ACTIVE`, `SYNC_PAUSED`, `REAUTH_REQUIRED`, `CONNECTION_ERROR`, `DISCONNECTED`.

| State | Scope | Meaning | Labels (EN / AR) | Badge |
|---|---|---|---|---|
| `NOT_SUPPORTED` | provider | No AWJ integration for this platform; technical `BLOCKED`. | Not available / غير متاح | muted |
| `AWAITING_PROVIDER_APPROVAL` | provider | Technical `OWNER_GATE`, or READY but not released. | Pending agreement / بانتظار الاتفاق مع المنصة | muted |
| `READY_TO_CONNECT` | provider (+ tenant eligibility) | Gate passed and released; this tenant has no connection. | Ready to connect / جاهز للربط | neutral |
| `AUTHORIZATION_PENDING` | connection | Authorization started, not completed. | Authorization pending / بانتظار التفويض | warning |
| `CONNECTED` | connection | Credentials verified, merchant identity confirmed; sync never started. | Connected · sync off / متصل · المزامنة متوقفة | neutral |
| `SYNC_ACTIVE` | connection | At least one verified store mapped; events flowing to the Hub. | Sync active / المزامنة نشطة | neutral |
| `SYNC_PAUSED` | connection | Was active; halted by the user or by a gate. | Sync paused / المزامنة متوقفة مؤقتاً | warning |
| `REAUTH_REQUIRED` | connection | Provider credentials invalid/expired/revoked. Fail-closed. | Reauthorization required / يلزم إعادة التفويض | warning |
| `CONNECTION_ERROR` | connection | Persistent non-auth failure. | Connection error / خطأ في الاتصال | negative |
| `DISCONNECTED` | connection | Credentials removed by an authorized action. History kept. | Disconnected / تم فصل الربط | muted |

(`DISCONNECTED` is deliberately *not* «غير متصل»: that phrase also describes "never connected" and would blur the two.)

### 6.2 Transition diagram

```mermaid
stateDiagram-v2
  direction LR
  state "Provider level (manifest, all tenants)" as P {
    [*] --> NOT_SUPPORTED: technical BLOCKED
    [*] --> AWAITING_PROVIDER_APPROVAL: technical OWNER_GATE
    AWAITING_PROVIDER_APPROVAL --> READY_TO_CONNECT: G1-G9 + release PR
    NOT_SUPPORTED --> AWAITING_PROVIDER_APPROVAL: new evidence changes technical status
    READY_TO_CONNECT --> AWAITING_PROVIDER_APPROVAL: connect_enabled revoked
  }
  READY_TO_CONNECT --> AUTHORIZATION_PENDING: manage + preconditions
  AUTHORIZATION_PENDING --> CONNECTED: credentials verified + identity confirmed
  AUTHORIZATION_PENDING --> READY_TO_CONNECT: denied / cancelled / expired / identity mismatch
  CONNECTED --> SYNC_ACTIVE: ≥1 verified mapping + explicit start
  SYNC_ACTIVE --> SYNC_PAUSED: user pause or gate failure
  SYNC_PAUSED --> SYNC_ACTIVE: user resume (gates satisfied)
  CONNECTED --> REAUTH_REQUIRED: provider auth failure
  SYNC_ACTIVE --> REAUTH_REQUIRED: provider auth failure
  SYNC_PAUSED --> REAUTH_REQUIRED: provider auth failure
  REAUTH_REQUIRED --> CONNECTED: reauthorized (sync never started)
  REAUTH_REQUIRED --> SYNC_PAUSED: reauthorized (sync had been active)
  CONNECTED --> CONNECTION_ERROR: persistent failure
  SYNC_ACTIVE --> CONNECTION_ERROR: persistent failure
  SYNC_PAUSED --> CONNECTION_ERROR: persistent failure
  CONNECTION_ERROR --> CONNECTED: recovered (sync never started)
  CONNECTION_ERROR --> SYNC_PAUSED: recovered (sync had been active)
  CONNECTED --> DISCONNECTED: disconnect
  SYNC_ACTIVE --> DISCONNECTED: disconnect
  SYNC_PAUSED --> DISCONNECTED: disconnect
  REAUTH_REQUIRED --> DISCONNECTED: disconnect
  CONNECTION_ERROR --> DISCONNECTED: disconnect
  DISCONNECTED --> AUTHORIZATION_PENDING: reconnect (new authorization; mapping reuse per DP-A)
```

### 6.3 Transition table

| # | From → To | Trigger | Actor / permission | Preconditions (all server-side) | Audit event | UI effect |
|---|---|---|---|---|---|---|
| T1 | `READY_TO_CONNECT` → `AUTHORIZATION_PENDING` | Start authorization | `delivery_connector.manage` | `sales.pos` enabled, subscription active, manifest `connect_enabled`, no active connection for this merchant, eligible operator, branch scope | `authorization.started` | Wizard step 2. |
| T2 | `AUTHORIZATION_PENDING` → `CONNECTED` | Provider verification succeeds and user confirms identity | System + same user | Credentials verified, identity confirmed, no identity mismatch, merchant not already bound to another tenant (`DP-D`) | `connection.verified` | Success message (sync off). |
| T3 | `AUTHORIZATION_PENDING` → `READY_TO_CONNECT` | Denied, cancelled, expired, identity mismatch | User / system | — (nothing retained) | `authorization.failed` (reason code, no secrets) | Reason shown; retry possible. |
| T4 | `CONNECTED` → `SYNC_ACTIVE` | Start sync | `delivery_connector.manage` | ≥1 verified mapping, gates satisfied, manifest `sync_enabled` | `sync.started` | Hub-only confirmation. |
| T5 | `SYNC_ACTIVE` ⇄ `SYNC_PAUSED` | Pause / resume; automatic pause when `application_inactive`, `subscription_inactive`, `actor_unavailable` persist, or manifest `sync_enabled` turns false | User or system | Resume requires gates satisfied | `sync.paused` / `sync.resumed` (with cause) | Warning banner with cause and the fix. |
| T6 | `CONNECTED`/`SYNC_*` → `REAUTH_REQUIRED` | Provider reports invalid/expired/revoked credentials, or refresh fails after the provider-documented retries | System | — | `reauth.required` | Sync halts; banner with **Reauthorize**. |
| T7 | `REAUTH_REQUIRED` → `CONNECTED` / `SYNC_PAUSED` | Reauthorization completes with same merchant identity | `delivery_connector.manage` | Identity equals original | `reauth.completed` | User presses Resume if needed. |
| T8 | `CONNECTED`/`SYNC_*` → `CONNECTION_ERROR` | Persistent non-auth failure (provider unreachable beyond threshold, repeated `payload_conflict`, mapping conflict) | System | Threshold per adapter | `connection.error` (code) | Error panel + **Retry check**. |
| T9 | `CONNECTION_ERROR` → previous | Recovery confirmed | System / user retry | N consecutive successes | `connection.recovered` | Banner cleared. |
| T10 | any connection state → `DISCONNECTED` | Disconnect | `delivery_connector.manage` | Confirmation (§5.7) | `connection.disconnected`, `credentials.purged`, `credentials.revoked`\|`revocation.unconfirmed` | Impact summary. |
| T11 | `DISCONNECTED` → `AUTHORIZATION_PENDING` | Reconnect | `delivery_connector.manage` | As T1; mapping reuse blocked until `DP-A` | `authorization.started` | New wizard. |
| T12 | provider-level transitions | Manifest change merged | Release PR only | G1-G9 | n/a (repository history) | Applies to all tenants at deploy. |

**Invalid transitions** (must be rejected by the future state service and by tests): `NOT_SUPPORTED`/`AWAITING_PROVIDER_APPROVAL` → any connection state; `CONNECTED` → `SYNC_ACTIVE` without a verified mapping; `DISCONNECTED` → `SYNC_ACTIVE`/`CONNECTED` without a new authorization; any transition that skips identity confirmation.

### 6.4 Mapping to existing backend states

| UX state | Existing backend equivalent | Note |
|---|---|---|
| `NOT_SUPPORTED` | None in code. Evidence report: technical `BLOCKED`. | Needs the manifest (GAP-1). |
| `AWAITING_PROVIDER_APPROVAL` | None in code. Evidence report: technical `OWNER_GATE`. | Same. |
| `READY_TO_CONNECT` | None. No provider is `READY`. | Same. |
| `AUTHORIZATION_PENDING` | None. | `DESIGN_ONLY`. |
| `CONNECTED` | **None.** `DeliveryConnectorAccount.status = configured` is *not* this. | `configured` means "AWJ ingress endpoint exists with a secret". It proves no provider credential and no merchant identity. |
| `SYNC_ACTIVE` | **None.** An `accepted` attempt proves only that an AWJ-signed caller delivered an event. | Not a provider heartbeat. |
| `SYNC_PAUSED` | Partial and *per event*: `application_inactive`, `subscription_inactive`, `actor_unavailable`, `connector_disabled` are returned and do not consume the event id. | Not stored as a state. |
| `REAUTH_REQUIRED` | None. | `DESIGN_ONLY`. |
| `CONNECTION_ERROR` | None as a state. `DeliveryConnectorAttempt.error_code` records per-event failures. | `DESIGN_ONLY` as a state. |
| `DISCONNECTED` | `DeliveryConnectorAccount.status = disabled` (+ `disabled_at`) is the only analog, for the internal ingress only. No credential revocation exists. | No re-enable route (GAP-4). |

### 6.5 What the UI must do with `configured` / `disabled` today

If ingress accounts are ever surfaced (`DP-C`), they appear under their own heading and wording (§5.3). `configured` → «نقطة استقبال مهيأة» / "Ingress configured". `disabled` → «نقطة الاستقبال معطّلة» / "Ingress disabled". They are never mapped onto the ladder rows C or D.

---

## 7. Security and accounting boundaries

### 7.1 Requirement → design → enforcement → verification

| Mandatory requirement | Design rule | Enforcement point (existing unless stated) | Verification |
|---|---|---|---|
| **Tenant isolation** | Every data request is tenant-scoped; foreign ids behave as not found. No client-provided tenant. | `TenantScope`, `SetTenant`; Core: tenant from the account row, never the payload; show/rotate of another tenant is 404. | Existing `DeliveryConnectorCoreTest`; new tests per task. |
| **Branch-level authorization** | Restricted users see/act only on connections/stores on their branches; unrouted accounts hidden from them; a restricted user cannot create an unrouted one. Mapping picker lists only accessible, active branches. | `DeliveryConnectorAccount::visibleTo`, `destinationOrFail`, `branchFailure`. | Core tests; UI tests with a restricted-user fixture. |
| **Encrypted credential handling** | Provider secrets/tokens stored only server-side, encrypted; shown at most once; never returned by reads. Storage mechanism for provider tokens is `DP-B`/DG-7. | `encrypted` cast pattern (`WebhookEndpoint`, `PaymentGateway`, `DeliveryConnectorAccount`). | Test: resource payloads contain no secret fields; DB value ≠ plaintext. |
| **No secrets in UI or logs** | One-time reveal dialog only (masked by default, explicit "I saved it" before close, state cleared on close); never in `localStorage`/`sessionStorage`/URL/query string/analytics/error toasts; no raw payloads rendered; error strings come from a code dictionary, not server text. | `SecretRevealDialog` design (§5.9 reuse), Core: no log of secret or signature header. | Component tests assert no storage writes and that unmount clears the secret; grep test for `console.*` near secret fields. |
| **Explicit merchant/store identity verification** | Step 3 of §5.4 plus store-level confirmation in §5.5; provider-returned values are untrusted text; mismatched CR/VAT stops the flow; reauth must match the original identity. | New adapter + state service (future). | Adapter contract tests; mismatch test blocks T2/T7. |
| **Idempotent synchronization** | UI never invents idempotency; it surfaces the Core rules: replay is not an error, `payload_conflict` is a conflict, `state_not_applied` is "received, unchanged". Retried authorization callbacks are idempotent on `state`. | Core: `(account, event_id)` + authoritative checksum; Hub permanent identity. | Existing Core tests; callback-replay test in the authorization task. |
| **Auditable connection changes** | Append-only audit event for every lifecycle change (catalog in §7.4); the model rejects update/delete like `DeliveryConnectorOperatorEvent`. Only operator reassignment is audited today (GAP-3). | `DP-F` → `INT-AUDIT-1`. | Append-only test; every transition in §6.3 has an event. |
| **Safe disconnect & credential revocation** | Fail-closed order in §5.7; never claim a provider-side revoke that was not performed; partial failure is visible. | Future state service. | Test: after disconnect no credential material is readable; sync rejected. |
| **No cross-tenant connection reuse** | The provider merchant account may be active for one tenant only; store ids stay globally unique; `mapping_ambiguous` is generic. | Store uniqueness exists; merchant-account uniqueness is `DP-D`. | Cross-tenant test: second tenant cannot bind the same merchant account or store. |
| **No automatic accounting invoice from Hub orders** | No "create invoice" action on any synced order; copy states Hub records are operational; no route from the Center to `InvoiceService`/`PaymentService`/`LedgerService`/`InventoryService`. | Core: no connector path references those services; counts asserted unchanged. | Static test: the integrations module imports none of those clients; Core negative-count tests extended. |
| **No financial posting, VAT, commission or settlement changes** | The Center is read-only over profiles and writes nothing to financial roles. `OD-DG-3-TAX-POINT` Option D, PASS-8 gates and `DG-3-PROVIDER-READINESS` remain open and untouched. | `DeliveryFinancialRoleGate`. | `DeliveryFinancialRoleGateTest` unchanged and green. |
| **Preserve manual POS attribution and reports** | Center does not write to `DeliveryPlatformProfile`; `/delivery-platforms`, POS picker and the channel report keep their contracts. Deep links only. | Existing endpoints untouched. | Existing POS/report suites unchanged; a regression test that the Center's code has no write call to `/delivery-platforms`. |

### 7.2 Client-side hardening rules

- Credential inputs: `type="password"`, `autocomplete="off"`, `spellcheck="false"`, cleared on unmount, never echoed back.
- Provider-returned strings are rendered as text only (no `dangerouslySetInnerHTML`, no markdown, no auto-linking), truncated with full value available in `TechnicalDetails`.
- OAuth-style redirects: server-generated `state` bound to tenant+user and expiring; the callback is handled on the backend; the browser never sees tokens.
- Open-redirect safe: return URLs are allow-listed relative paths.
- All state-changing calls send an `Idempotency-Key` where the endpoint supports one (future endpoints must).
- Dialog actions require explicit confirmation; no destructive action on a single click.

### 7.3 Accounting non-goals (explicit)

Not designed, not hinted at in the UI: imported-order invoices, payments, journals, VAT, platform receivable clearing from synced data, commission, settlement, reconciliation, refunds. `DLV-COMMISSION-1`, `DLV-SETTLEMENT-1`, `DLV-RECON-1`, `DLV-REFUND-1`, `DG-6-TRIGGER` stay blocked. The Center never displays financial amounts from provider data.

### 7.4 Proposed audit event catalog (`DP-F`, not implemented)

Append-only; fields: tenant, connection id (or ingress account id), platform key, actor user id, event code, reason code, timestamp, request id, branch id when relevant. **No secrets, tokens, payloads or provider response bodies.** User ids as plain uuids (no FK), as in `delivery_connector_operator_events`.

`authorization.started|failed`, `connection.verified|error|recovered|disconnected`, `credentials.purged`, `credentials.revoked`, `revocation.unconfirmed`, `reauth.required|completed`, `store.mapped`, `sync.started|paused|resumed`, `secret.rotated`, `operator.reassigned` (exists), `ingress.created`, `ingress.disabled`.

---

## 8. User journeys

| ID | Journey | Steps (tenant owner unless stated) | Outcome |
|---|---|---|---|
| **J1** | Explore (works today) | Settings → Integrations → Delivery platforms → open HungerStation → read ladder → follow "Set up POS attribution". | Understands that native integration is not available and that manual attribution is. |
| **J2** | Set up manual attribution (works today) | From provider page → `/delivery-platforms` → enable, choose collection mode and reference policy → save (`company.manage`). | A becomes "Set up". Nothing about B/C/D changes. |
| **J3** | Read-only colleague (accountant/staff) | Open Center → catalog → provider page. No connection tabs, no management links beyond `reports.view`/`invoices.view` ones. | Same truth, no admin surface. |
| **J4** | Connect (`DESIGN_ONLY`) | Provider is `READY_TO_CONNECT` → Connect → steps 1-5 → `CONNECTED` → map stores → Start sync → `SYNC_ACTIVE` → watch Hub. | Hub-only operational flow. |
| **J5** | Credentials expire (`DESIGN_ONLY`) | Banner `REAUTH_REQUIRED` → Reauthorize → identity check passes → `SYNC_PAUSED` → Resume. | History and mappings intact. |
| **J6** | Disconnect (`DESIGN_ONLY`) | Disconnect → impact preview → confirm → stop sync → revoke or instruct → purge → audit → `DISCONNECTED`. | Safe exit; nothing deleted from Hub. |
| **J7** | Investigate failures (`GATED`) | Activity tab → filter `payload_conflict` → open row → see code and Hub link → fix mapping or contact the integration owner. | No raw payload exposure. |
| **J8** | Operator left the company (ingress, `EXISTS` API) | Events fail `actor_unavailable` → admin opens the connector → Reassign to an eligible user → (if needed) rotate secret separately. | Same `event_id` succeeds after reassignment (ownership packet). |

---

## 9. UX deliverables

### 9.1 Navigation placement

- Add one entry to the sidebar **`settings`** group, after `applications` and before `accountSettings`: `{ href: '/integrations', icon: Plug, key: 'integrations', built: true }`. No `appKey` (the Center spans future categories) and no group-level `permission`; per-category access is decided inside the page (§2.4).
- The `developer` group stays separate: it is for a tenant's own programmatic access (API keys, webhooks), a different audience and different trust direction.
- `Delivery platforms` and `Delivery hub` stay in the Sales group, unchanged. Provider pages cross-link to them.
- Breadcrumb: Settings › Integrations › Delivery platforms › {Platform}.
- Mobile: appears in the drawer under Settings like its siblings.

### 9.2 Status and permission matrix

Existing permission names only. `owner`/`admin` hold `*`.

| Capability | Gate | owner/admin | accountant | staff | self_service |
|---|---|:-:|:-:|:-:|:-:|
| See Integration Center, catalog, provider Overview | `invoices.view` + `sales.pos` enabled | ✓ | ✓ | ✓ | ✗ |
| Open Hub deep link | `delivery_hub.view` | ✓ | ✗ | ✗ | ✗ |
| Open channel report deep link | `reports.view` | ✓ | ✓ | ✓ | ✗ |
| Edit manual platform profile (existing page) | `company.manage` | ✓ | ✗ | ✗ | ✗ |
| See ingress accounts / connection tabs | `delivery_connector.view` | ✓ | ✗ | ✗ | ✗ |
| Create / rotate / disable ingress; connect, reauthorize, pause/resume, disconnect (future) | `delivery_connector.manage` | ✓ | ✗ | ✗ | ✗ |
| Reassign operator | `delivery_connector.reassign` | ✓ | ✗ | ✗ | ✗ |
| View activity & errors (future) | `delivery_connector.view` | ✓ | ✗ | ✗ | ✗ |

Custom roles get exactly the permissions they are granted. Branch-restricted users additionally see only connections/stores on their branches (§7.1). The accountant seeing only static readiness is a deliberate consequence of "no new permissions"; whether finance roles should see connection health is `DP-E`.

| UX state | Who sees it | Primary action shown | Actions absent |
|---|---|---|---|
| `NOT_SUPPORTED` | catalog readers | none | everything connection-related |
| `AWAITING_PROVIDER_APPROVAL` | catalog readers | none | everything connection-related |
| `READY_TO_CONNECT` | catalog readers; manage holders get **Connect** | Connect | — |
| `AUTHORIZATION_PENDING` | manage/view | Continue / Cancel | Start sync |
| `CONNECTED` | view | Map stores / Start sync | Resume |
| `SYNC_ACTIVE` | view | Pause | Start sync |
| `SYNC_PAUSED` | view | Resume | Pause |
| `REAUTH_REQUIRED` | view | Reauthorize | Resume, Start sync |
| `CONNECTION_ERROR` | view | Retry check | Start sync |
| `DISCONNECTED` | view | Reconnect (subject to `DP-A`) | Pause, Resume |

### 9.3 Labels (Arabic / English)

Namespace proposal: `integrationCenter` (new; the existing `platformIntegrations` namespace belongs to Document Center settings and must not be reused or confused).

| Key | العربية | English |
|---|---|---|
| `nav.integrations` | التكاملات | Integrations |
| `title` | التكاملات | Integrations |
| `subtitle` | اربط أَوْج بالأنظمة الخارجية وتابع حالتها بدقة. | Connect AWJ to external systems and track their status accurately. |
| `category.delivery` | منصات التوصيل | Delivery platforms |
| `category.deliveryDesc` | الإسناد اليدوي في نقطة البيع، وصندوق التوصيل، والتكاملات الأصلية عند توفرها. | Manual POS attribution, the Delivery Hub, and native integrations when available. |
| `planned.title` | فئات مخطط لها | Planned categories |
| `planned.note` | لا تتوفر حالياً أي تكاملات مع منصات خارجية في هذه الفئات. | No integrations with external platforms are available in these categories yet. |
| `planned.ecommerce` | التجارة الإلكترونية | E-commerce |
| `planned.payments` | بوابات الدفع | Payment gateways |
| `planned.shipping` | مزوّدو الشحن | Shipping providers |
| `ladder.a` | الإسناد اليدوي في نقطة البيع | Manual POS attribution |
| `ladder.b` | التكامل الأصلي | Native integration |
| `ladder.c` | حساب التاجر | Merchant account |
| `ladder.d` | مزامنة الطلبات | Order synchronization |
| `ladder.unavailable` | غير متاح قبل توفر تكامل أصلي | Unavailable until a native integration exists |
| `a.unset` / `a.set` / `a.disabled` | غير مهيأة / مهيأة / معطّلة | Not set up / Set up / Disabled |
| `b.none` / `b.pending` / `b.available` | غير متاح / بانتظار الاتفاق / متاح | Not available / Pending agreement / Available |
| `state.NOT_SUPPORTED` | غير متاح | Not available |
| `state.AWAITING_PROVIDER_APPROVAL` | بانتظار الاتفاق مع المنصة | Pending agreement with the platform |
| `state.READY_TO_CONNECT` | جاهز للربط | Ready to connect |
| `state.AUTHORIZATION_PENDING` | بانتظار التفويض | Authorization pending |
| `state.CONNECTED` | متصل · المزامنة متوقفة | Connected · sync off |
| `state.SYNC_ACTIVE` | المزامنة نشطة | Sync active |
| `state.SYNC_PAUSED` | المزامنة متوقفة مؤقتاً | Sync paused |
| `state.REAUTH_REQUIRED` | يلزم إعادة التفويض | Reauthorization required |
| `state.CONNECTION_ERROR` | خطأ في الاتصال | Connection error |
| `state.DISCONNECTED` | تم فصل الربط | Disconnected |
| `reason.notSupported` | لا يتوفر تكامل مع هذه المنصة في أَوْج بعد. | No integration with this platform is available in AWJ yet. |
| `reason.pending` | يتطلب التكامل اتفاقاً ووصولاً تجريبياً من المنصة. | Integration requires an agreement and test access from the platform. |
| `works.title` | ما يعمل اليوم في أَوْج | What works today in AWJ |
| `works.pos` | تسجيل المنصة على مبيعات التوصيل في نقطة البيع | Record the platform on POS delivery sales |
| `works.hub` | إدخال طلبات التوصيل وإدارتها يدوياً في صندوق التوصيل | Enter and manage delivery orders manually in the Delivery Hub |
| `works.report` | عرض مبيعات قناة التوصيل في التقرير | See delivery-channel sales in the report |
| `requires.title` | ما يتطلبه التكامل الأصلي | What native integration would require |
| `requires.agreement` | اتفاق مع المنصة | An agreement with the platform |
| `requires.testAccess` | وصول تجريبي صادر لأَوْج | Test access issued to AWJ |
| `requires.spec` | مواصفة تقنية معتمدة | An approved technical specification |
| `requires.notYet` | غير متوفر بعد | Not yet available |
| `hubOnlyNote` | الطلبات الواردة عبر أي تكامل مستقبلي تظهر في صندوق التوصيل كسجلات تشغيلية. لا تنشئ فواتير ولا مدفوعات ولا ضريبة ولا عمولة ولا تسوية. | Orders that arrive through a future integration appear in the Delivery Hub as operational records. They do not create invoices, payments, VAT, commission or settlement. |
| `manualUnchanged` | الإسناد اليدوي في نقطة البيع والتقارير لا يتغيران. | Manual POS attribution and reports are unchanged. |
| `ingress.title` | استقبال أحداث موقّعة من أَوْج — ليس ربطاً مع المنصة | AWJ-signed event ingress — not a connection to the platform |
| `ingress.configured` / `ingress.disabled` | نقطة استقبال مهيأة / معطّلة | Ingress configured / disabled |
| `action.view` | عرض التفاصيل | View details |
| `action.retry` | إعادة المحاولة | Try again |
| `action.refresh` | تحديث | Refresh |
| `action.reauthorize` | إعادة التفويض | Reauthorize |
| `action.pause` / `action.resume` | إيقاف مؤقت / استئناف | Pause / Resume |
| `action.disconnect` | فصل الربط | Disconnect |
| `action.rotate` | تدوير السر | Rotate secret |
| `action.reassign` | إعادة إسناد المشغّل | Reassign operator |

### 9.4 Message catalog (empty / error / success / confirmation)

| Situation | العربية | English |
|---|---|---|
| Empty events | لا توجد أحداث بعد. | No events yet. |
| No events received | لم يصل أي حدث بعد. | No events received yet. |
| Empty stores | لم يُرجِع المزوّد أي متجر لهذا الحساب. | The provider returned no stores for this account. |
| Load failed | تعذّر تحميل البيانات. | Could not load the data. |
| Permission denied | ليست لديك صلاحية عرض هذه الصفحة. اطلب من المالك أو المدير. | You do not have permission to view this page. Ask an owner or admin. |
| App off | تطبيق نقاط البيع غير مفعّل لهذه المؤسسة. | The POS application is not enabled for this organization. |
| Subscription inactive | الاشتراك غير فعّال، لذلك الإجراءات غير متاحة. | The subscription is inactive, so actions are unavailable. |
| Provider not ready (server) | هذا التكامل غير متاح بعد. | This integration is not available yet. |
| Authorization verified | تم توثيق حساب التاجر. لم تبدأ مزامنة الطلبات بعد. | Merchant account verified. Order synchronization has not started yet. |
| Identity mismatch | حساب التاجر الذي أرجعه المزوّد لا يطابق بيانات مؤسستك. لم يُحفظ شيء. | The merchant account returned by the provider does not match your organization. Nothing was saved. |
| Sync started | بدأت مزامنة الطلبات. تظهر الطلبات في صندوق التوصيل كسجلات تشغيلية فقط. | Order synchronization started. Orders appear in the Delivery Hub as operational records only. |
| Paused | أُوقفت المزامنة مؤقتاً. لا تُحذف أي طلبات. | Synchronization paused. No orders are deleted. |
| Disconnect confirm | سيتم إيقاف المزامنة وإزالة بيانات الاعتماد. تبقى كل الطلبات والسجلات. | Synchronization will stop and credentials will be removed. All orders and records are kept. |
| Revocation unconfirmed | سُحبت الصلاحيات محلياً. يلزم إلغاء التفويض من بوابة المنصة. | Credentials were removed locally. Revoke authorization in the platform's portal. |
| Mapping save confirm | لا يمكن تغيير الفرع بعد الحفظ. | The branch cannot be changed after saving. |
| Store already mapped | معرّف المتجر مربوط مسبقاً ولا يمكن إعادة استخدامه. إن كان متجرك فتواصل مع الدعم. | This store id is already mapped and cannot be reused. If it is your store, contact support. |
| Secret shown once | احفظ السر الآن. لن يُعرض مرة أخرى. | Save the secret now. It will not be shown again. |
| Rotate result | تم تدوير السر. السر السابق لم يعد صالحاً. | The secret was rotated. The previous secret is no longer valid. |
| Reassign done | تمت إعادة الإسناد. لم يتغير السر. | Reassigned. The secret was not changed. |
| Operator ineligible | المستخدم المختار غير مؤهل لهذا الربط أو هذا الفرع. | The selected user is not eligible for this connection or branch. |
| Disable irreversible | لا يمكن إعادة التفعيل من هنا حالياً. | This cannot be re-enabled from here at the moment. |

### 9.5 Responsive layout

| Breakpoint | Behavior |
|---|---|
| `< 640` | Single column; catalog as cards; provider tabs become a horizontally scrollable tab strip with visible scroll affordance (no page-level horizontal scroll); dialogs top-aligned; destructive confirmations as bottom `Sheet`; sticky bottom action bar only where a primary action exists, with `pb-16`. |
| `sm` | Two-column shells where useful (ladder rows with value on the end side). |
| `md` (≥ 768) | Tables replace cards (switch point from `responsive.md`). |
| `lg` (≥ 1024) | Fixed sidebar; provider page may show the ladder beside the explanatory blocks (`grid-cols-[minmax(0,1fr)_22rem]`, same split as `/delivery-platforms`). |
| RTL / LTR | Logical properties only; chevrons and "back" icons mirror; numerals, ids and timestamps keep LTR isolation; tab order follows reading order. Visual QA captured in both locales at 375 px and 1280 px for each screen. |

### 9.6 Accessibility requirements (WCAG 2.1 AA; `design-system/accessibility/standards.md`)

- Tab order matches reading order in both directions; every interactive element has a visible focus ring (`--primary`).
- State is never conveyed by color alone: icon + text on every badge; the ladder is a labeled list (`<dl>` or `role="list"` with each row's name and value in one accessible name, e.g. "Native integration: Pending agreement").
- Tab strip uses `role="tablist"` semantics via the existing `Tabs`; tabs absent for ungated providers are not in the DOM.
- Status changes: `aria-live="polite"` on refresh timestamps and sync banners; destructive results `role="alert"`.
- Dialogs: focus trap, `Escape` closes (except while a one-time secret is unacknowledged), focus returns to the trigger.
- Icon-only buttons carry `aria-label`; copy buttons announce "Copied".
- Targets ≥ 44 × 44 px on touch; contrast AA for text including `muted` on `surface`.
- Reduced motion respected; no auto-advancing UI.
- Dense tables keep a visible caption (`sr-only` acceptable), column headers with `scope="col"`.
- Provider-returned text with mixed script uses `dir="auto"`; identifiers `dir="ltr"`.
- Time-based displays ("2 min ago") expose the absolute timestamp via `<time dateTime>`.

### 9.7 Provider readiness gating rules (summary)

R-GATE-1…6 (§4.3), R-LADDER-1…3 (§3.1), R-COPY-1…3 (§3.2), R-MAP-1…5 (§5.5). The invariant: **a control that starts a connection exists only when the server says the provider is released, and the server re-checks.**

### 9.8 Existing-component reuse plan

| Need | Reuse | Path | Note |
|---|---|---|---|
| Platform mark and name | `DeliveryPlatformMark`, `deliveryPlatformLabel`, registry | `web/src/components/delivery/delivery-platform-mark.tsx`, `web/src/lib/delivery-platform-registry.ts` | Only source; no second registry. |
| Status chips | `Badge` | `web/src/components/ui/badge.tsx` | Tone map §5.0. The private `StatusBadge` in the delivery-platforms workspace is not exported; the Center should add its own small wrapper, not export that file's internals. |
| Catalog table / cards | `Table`; mobile list pattern from `/delivery-platforms` | `web/src/components/ui/table.tsx`, `web/src/components/delivery-platforms/delivery-platforms-workspace.tsx` | Six static rows: no `DataTable` sorting needed. |
| Activity log | `DataTable` with `serverSort`, `selection` unnecessary | `web/src/components/data-table.tsx` | Server pagination. |
| Provider tabs | `Tabs`, `TabPanel` | `web/src/components/ui/tabs.tsx` | As in the Settings page. |
| Detail drawer | `Sheet` | `web/src/components/ui/sheet.tsx` | Event detail, mobile confirmations. |
| Confirmations | `ConfirmDialog` | `web/src/components/developer/confirm-dialog.tsx` | Lives under `developer`; extract to a neutral location in the first task that needs it (note below). |
| One-time secret | `SecretRevealDialog` | `web/src/components/developer/secret-reveal.tsx` | Bound to the `developer.secret` namespace; needs a prop for translations or a neutral wrapper (an `INT-UX` follow-up, not part of this task). |
| Technical ids/evidence | `TechnicalDetails` | `web/src/components/ui/technical-details.tsx` | Per `design-system/foundations/human-readable-technical-data.md`. |
| Branch selection | `Select`/`Combobox`; branch scope helpers | `web/src/components/ui/select.tsx`, `combobox.tsx`, `web/src/components/layout/branch-scope.tsx` | Only accessible, active branches. |
| Skeleton / toast | `Skeleton`, `Toast` | `web/src/components/ui/*` | Per states pattern. |
| Permission checks | `hasPermission` | `web/src/lib/permissions.ts` | Mirror of `Rbac::allows`. |
| Nav gating | `isNavEntryVisible` | `web/src/components/layout/nav-visibility.ts` | Entry has no `appKey`/`permission`. |
| API client | `api` | `web/src/lib/api.ts` | Bearer token, 401 redirect. |

---

## 10. Decision Packets (documented, **not implemented**)

Each is raised because the design needs a change to an existing financial/security contract or a strategic commitment. **None is decided here.**

### DP-A — Store re-mapping and re-enable

- **Context.** `platform_key`, `external_store_id`, profile and branch are immutable after create; the pair is globally unique; disable keeps the store id reserved; no re-enable route exists (`DeliveryConnectorAccount::booted`, migration `delivery_connector_store_unique`, controller routes).
- **Effect on UX.** A store can never move to another branch; a disconnected store can never be reattached; "Reconnect" cannot reuse the mapping.
- **Options.** (1) Keep immutable; reconnection always creates new mappings under new ids (impossible for the same provider store id). (2) Add a guarded, audited **re-enable** of the same mapping by the same tenant. (3) Add a guarded, audited **branch re-home** with an in-flight-order policy. (4) Allow releasing a store id after verified disconnect.
- **Recommendation.** (2) first (smallest, same tenant, no branch change), (3) only with the policy below, (4) rejected as a general rule (see the squatting note).
- **Minimum conditions for option (2) re-enable / reconnect** (all server-side, all required):
  1. **Provider identity must match.** A provider connection may reattach a store mapping only if the newly verified provider merchant/store identity equals the identity recorded at the first verified connection. Otherwise the mapping stays closed and the tenant must use a different store id. Reattachment is never based on a typed id alone.
  2. **Fresh credentials.** Re-enable of an AWJ-signed ingress account must rotate the secret as part of the same action (a secret that existed while the account was disabled is never silently revived). A provider connection requires a new authorization.
  3. **Gates re-checked at enable time:** `sales.pos` enabled, subscription active, eligible `operated_by` (otherwise reassign first), caller holds `delivery_connector.manage` and passes `visibleTo`, and — for provider connections — manifest `connect_enabled`.
  4. **Atomic and audited:** under the account row lock, in the same transaction as one audit event (DP-F). Same tenant only.
  5. **No mapping change:** platform, store id, profile and branch are unchanged by re-enable.
- **Minimum conditions for option (3) branch re-home** (otherwise not offered):
  1. The actor must be able to access **both** the source and the destination branch (an unrouted connector can be re-homed only by an unrestricted actor); the destination must be active.
  2. **Open-order policy is written before building.** Connector Core rejects an event whose provider order already lives on another branch (`branch_unavailable`) and ties each authoritative baseline to the connector that wrote it. Re-homing while non-terminal Hub orders exist would strand those orders (their later events would be rejected). The policy must say whether re-home is blocked until they reach a terminal state, or how they are handled; historical orders keep their original branch.
  3. The current/new `operated_by` must still pass the destination branch check, or be reassigned in the same action.
  4. Atomic under the account lock with one audit event; no change to `event_id` identity, attempts, or Hub order identity.
  5. Changing the model's immutability rule is a security-contract change and needs its own approved implementation brief.
- **Squatting risk (recorded, not solved here).** Store ids are user-typed today and unverified, and a created mapping reserves the id for all tenants permanently. A tenant (or a typo) can therefore block another merchant's real store id. Once provider identity verification exists (ladder step C), uniqueness should bind to the *verified* provider identity (see DP-D). For mappings that were never provider-verified, release is a **platform-operator, audited dispute procedure** (the separate platform administrator surface), never a tenant action. Until then `mapping_ambiguous` copy tells the user to contact support (it never reveals the other tenant).
- **Needed from owner.** Pick an option before any task that offers "Reconnect" or "Change branch". Nothing in this packet authorizes changing the mapping columns, their immutability, or the unique index.

### DP-B — Connection persistence and provider-credential storage

- **Context.** No place exists for provider tokens/refresh tokens or connection state; DG-7 (external vault vs app-key `encrypted` cast) is open. Keeta's documented tokens expire (example `expiresIn` 7776000) and refresh within strict rate limits (Readiness §4.4), so tokens must be *writable and rotated*, unlike the current write-once secret.
- **Options.** (1) App-key encryption with versioned records (current pattern). (2) External vault. (3) Provider-held credentials only (not feasible for refresh flows).
- **Recommendation.** Decide DG-7 first; model the connection as its own tenant-scoped entity (not new values in `DeliveryConnectorAccount.status`), because the Core's `configured/disabled` pair is enforced by the model (`DomainException` otherwise) and must keep meaning "ingress".
- **Constraint.** The ten UX states are not DB enums; persistence stores facts (credential validity, last verified, sync intent) and derives the state.
- **Non-authorization.** Approving or discussing DP-B does **not** permit accepting, storing, logging, displaying or transmitting any provider credential or token. No credential field, endpoint or table may be built until (a) DP-B is decided with DG-7, (b) the provider passes G1-G9, and (c) the task brief is reviewed. This document and its UI specs contain no credential-handling behavior that is buildable on their own.
- **Minimum constraints once decided.** Encrypted at rest and never returned by any read; tenant-scoped; refresh runs single-flight under a row lock (Keeta's documented limits make concurrent refresh unsafe); an app-key rotation plan exists before tokens are stored under the `encrypted` cast (a lost key makes ciphertext unreadable and forces `REAUTH_REQUIRED`); no token in logs, audit rows, error messages or URLs; purge on disconnect.

### DP-C — Exposing internal HMAC ingress accounts in the tenant UI

- **Context.** The AWJ-signed ingress is real and working but is not a provider connection; a `dsec_…` secret in the hands of a merchant could be misread as "my HungerStation integration".
- **Options.** (1) Keep API-only. (2) Read-only list under a clearly-labeled "AWJ-signed event ingress" panel. (3) Full management UI (create, rotate, disable, reassign).
- **Recommendation.** (2) in the UX slices; (3) only after an owner decision on who legitimately builds custom adapters. Never within the ladder rows.
- **Decision (owner, 2026-10-13): option 2 approved for `INT-UX-4` only.** Not option 3, and not a standing approval for later slices.
  - **Scope of the approval.** A read-only panel inside the delivery-platform detail page, listing the already-existing signed-ingress points from `GET /api/delivery-connectors` (permission `delivery_connector.view` + application `sales.pos`). The approved term is «نقطة استقبال أحداث موقّعة». No new API, permission, table or migration.
  - **What it does not approve.** Any create / edit / disable / rotate / reassign / test / replay action (that stays `INT-UX-5`, still behind `INT-AUDIT-1`); any native provider connection, authorization, reconnect or sync; any change to readiness or to the capability ladder; any provider-store ↔ AWJ-branch mapping (`INT-MAP-1`); deploy or production release.
  - **Wording limits.** An ingress point is never described as «متصل بالمنصة», «حساب التاجر مرتبط», «المزامنة مفعّلة» or «جاهز للتكامل الأصلي». The panel states that a point may be routed to a branch and that this does not map the provider's store to a branch, and that ingress status is not provider readiness.
  - **Data limits.** Shown: store id, branch name (only with `branches.view`; otherwise a neutral «موجّهة إلى فرع»), the server's status, secret *version*, creation date. **Never** shown or held in UI state: the secret, `secret_prefix`, signing keys, tokens, the ingress id, operator/configurer identifiers. This **supersedes** the "secret prefix … operator" list in §5.3 and the INT-UX-4 scope line below: the prefix is a fragment of the signing secret, and there is no approved source for operator names in this slice.
  - **`DP-E` is unchanged**: owner/admin only through the existing `delivery_connector.view`; finance roles do not gain visibility.
- **Decision (owner, 2026-10-14): option 3 approved for `INT-UX-5` only**, to manage the **AWJ-signed ingress** — never a native provider integration. Not a standing approval and not a precedent for any other slice. Decisions D1–D10 of `INT-UX-5-SCOPE-AND-READINESS-REPORT.md` are adopted as recommended, with these controls:
  - **Audience (D1).** `owner`/`admin` and holders of the existing `delivery_connector.manage` (reassign: `delivery_connector.reassign`). **No new permission, no API or database change.**
  - **Operator identity (D2/D3).** Only the operator's **name** is shown (never email or other identifiers), and only to a user who holds `delivery_connector.reassign` **and** `users.view`. This **amends** the DP-C 2026-10-13 data limits for the reassign flow of this slice only.
  - **Delivery (D4).** Slices **5a → 5b → 5c → 5d**, each its own PR with its own approval.
  - **Rotate (D5).** Never offered for a disabled point (the server's permissiveness is a separate backend matter).
  - **Disable (D6).** Confirmed by typing the store ID; the dialog states irreversibility.
  - **Create (D7/D8).** If the tenant has no active manual profile, explain and link to the existing setup (no profile is created here). A lost create/rotate response is treated as **outcome unknown**: **no blind retry**; refresh the list and rotate if the secret was not saved.
  - **Copy (D9) and demo mode (D10).** The approved term «نقطة استقبال أحداث موقّعة» and the forbidden-phrase rules stand; demo mode shows a neutral unavailable state and never a fabricated secret.
  - **Secrets.** Never stored, logged, tracked, put in a URL, or shown outside the one-time reveal dialog.

### DP-D — Provider merchant-account uniqueness across tenants

- **Context.** Uniqueness exists on the store id only. A merchant account could in principle be authorized by two tenants.
- **Recommendation.** Global unique `(platform_key, provider_merchant_id)` for active connections, keyed on the **provider-verified** identity only (never a user-typed id, which would extend the squatting risk in DP-A), with the same generic error text (no oracle expansion), decided with `DP-B`.

### DP-E — Visibility of connection data to finance roles

- **Context.** `delivery_connector.*` is owner/admin only; accountants use the delivery report but cannot see connection health. "No new permissions" in this task.
- **Options.** (1) Keep owner/admin only. (2) Read-only health via an existing permission such as `reports.view`. (3) New read permission in a later task.
- **Recommendation.** (1) now. Revisit when health data exists.
- **Pending sub-decision (2026-10-14): read access to lifecycle audit rows.** Who may read `delivery_connector_lifecycle_events` / operator events is a DP-E decision that is **not yet made**. `INT-UX-6` owns the reader and is deferred until it is. Until then the rows are not exposed by any API or UI, and DP-E stays as recommended above (owner/admin only).

### DP-F — Connection-lifecycle audit

- **Context.** Rotate and disable are unaudited today (the service writes no event); only reassignment is audited.
- **Recommendation.** One append-only table, cataloged in §7.4, added **before** any UI or new endpoint that rotates, disables, enables, connects or disconnects. Back-fills nothing.
- **Rules.** (1) The audit row is written in the **same database transaction** as the operation; if the audit insert fails, the operation rolls back (fail-closed). (2) Writers live in the backend service layer, not the UI, so direct API calls to `rotate-secret`/`disable` are covered too. (3) Rows hold ids, version numbers (e.g. `secret_version` old→new) and reason codes only — never secrets, tokens, payloads or provider bodies. (4) Model rejects update/delete, like `DeliveryConnectorOperatorEvent`.
- **Decision (owner, 2026-10-14): approved, implemented by `INT-AUDIT-1` (this PR).** New append-only table `delivery_connector_lifecycle_events` (`ingress.created`, `secret.rotated`, `ingress.disabled`), written in the operation's own transaction (audit failure ⇒ rollback; a failed operation writes no event), in the backend service layer so direct API calls are covered. Limits recorded with the approval: **no new read API** (the reader waits for its own permission decision, `DP-E`), **no IP and no Request ID**, no secret / `secret_prefix` / token / request data, **branch re-route is out of scope** (the mapping is immutable and the operation does not exist), repeated `disable` is idempotent (200, original `disabled_at` kept, no second event). **Account/user ids carry no foreign key** (events must survive deletion of an account row; a cascade would erase security history and a restrict would block legitimate deletion); `platform_key` and `external_store_id` are copied so an event stays intelligible alone. The tenant column keeps its cascade (tenant erasure removes all tenant data, as in every other table).
- **Interim state (historical, before `INT-AUDIT-1`).** Rotate and disable through the **existing API** were unaudited; this design adds no new UI or caller for them before then (INT-UX-5 hard-depends on INT-AUDIT-1).

---

## 11. Implementation plan (small, independent tasks)

Two tracks. **Track U** (UX/catalog) is safe to build now and never touches provider authentication. **Track P** (authentication and synchronization) is **blocked** by owner gates and Decision Packets. Existing Horizon tasks `DLV-HUNGERSTATION-1` and `DLV-KEETA-1` remain the provider-adapter tasks; this plan does not rename or promote them.

**Common verification for any UI task:** `npm run build`, Vitest component tests in `web/`, both locales, RTL and LTR render checks at 375 px and 1280 px, restricted-user fixture. **For any backend task:** SQLite + PostgreSQL CI, negative authorization/isolation tests, `DeliveryConnectorCoreTest`, `DeliveryHubProjectionTest`, `DeliveryFinancialRoleGateTest` unchanged.

### Track U — UX and catalog (no provider authentication)

#### INT-READY-1 — Readiness manifest and server gate (backend, additive)
- **Scope.** Constant manifest (§4.2) with the six rows from `DLV-PROVIDER-READINESS-1`, a read-only endpoint, and a reusable guard `provider_not_ready`.
- **Depends on.** None (this document).
- **Acceptance.** All six `connect_enabled = sync_enabled = false`; derived UX states match §3.2; endpoint returns no tenant data; guard returns `409 provider_not_ready`.
- **Security.** Static data, no secrets, no tenant input; cannot be edited via any API.
- **Tests.** Table-driven derivation test; guard test; response snapshot; permission test for the endpoint (reuse `invoices.view` + `sales.pos`).
- **Excludes.** Any authorization route, adapter, DB table, new permission.

#### INT-UX-1 — Integration Center shell, navigation, landing
- **Scope.** `/integrations` page, sidebar entry (§9.1), `integrationCenter` i18n namespace, planned-categories list, permission/unavailable/loading/error states.
- **Depends on.** None (A only needs `GET /api/delivery-platforms`; B-summary uses INT-READY-1 once merged, otherwise the line is omitted rather than guessed).
- **Acceptance.** Screens 1 and 9 as specified; future categories non-interactive; no Connect anywhere.
- **Security.** No new endpoints; no request for data the user cannot view.
- **Tests.** Component tests: states, permission-denied makes no API call, planned items not focusable; i18n key parity AR/EN; nav visibility test.
- **Excludes.** Provider pages, any connector API call.

#### INT-UX-2 — Delivery platforms catalog and provider Overview
- **Scope.** Screens 2 and 3 (ladder component, reasons, "what works today", boundaries, TechnicalDetails evidence), cross-links.
- **Depends on.** INT-UX-1, INT-READY-1.
- **Acceptance.** Four-row ladder everywhere; C/D unavailable text per R-LADDER-1; six providers match §3.2; unknown key 404.
- **Security.** Provider-returned text is not involved yet; no mutation.
- **Tests.** **R-GATE-5 invariant test** (no Connect/Authorize/Link for any manifest row, both locales); ladder accessibility-name test; mobile/desktop render; "no write to `/delivery-platforms`" regression test.
- **Excludes.** Tabs other than Overview; ingress panel.

#### INT-UX-3 — Manual attribution panel integration
- **Scope.** Show the tenant's A value and deep links (profile setup, Hub, report), respecting `company.manage`, `delivery_hub.view`, `reports.view`.
- **Depends on.** INT-UX-2.
- **Acceptance.** Links appear only for entitled users; no edits inside the Center.
- **Security.** Read-only over profiles; Hub/report permission gating mirrored.
- **Tests.** Link visibility matrix per role; existing `/delivery-platforms`, POS picker and report suites unchanged.
- **Excludes.** Editing profiles, changing financial roles.

#### INT-UX-4 — Read-only AWJ-signed ingress panel *(DP-C option 2 approved 2026-10-13, for this slice only — limits under `DP-C`)*
- **Scope.** List `DeliveryConnectorAccount` rows per platform via existing `GET /api/delivery-connectors`; show store id, branch, status, secret prefix/version, operator; wording per §5.3/§6.5.
- **Depends on.** DP-C, INT-UX-2.
- **Acceptance.** Never uses Connected/Live/Synced; branch-restricted view hides unrouted/foreign rows; no secret fields in the UI model.
- **Security.** Secret never fetched (the resource does not return it); tenant/branch isolation preserved.
- **Tests.** Role/branch fixtures; resource-field assertion; wording test (forbidden words).
- **Excludes.** Create/rotate/disable/reassign.

#### INT-UX-5 — Ingress management actions *(DP-C option 3 approved 2026-10-14 for this slice only — see `DP-C`; delivered as 5a → 5b → 5c → 5d, each its own approval; 5a = neutral dialogs + foundations, no visible action — merged 2026-10-14; 5b = rotate + disable on the existing panel — merged 2026-10-14; 5c = create — implemented in a Draft PR, see `INT-UX-5C-IMPLEMENTATION-REPORT.md`; refresh/tab-close protection deferred to the backend-idempotency follow-up)*
- **Scope.** Create, rotate (with one-time reveal), disable (with irreversibility warning), reassign operator, using the **existing** endpoints; extract/neutralize `ConfirmDialog` and `SecretRevealDialog` for shared use.
- **Depends on.** INT-UX-4, DP-C, **INT-AUDIT-1 (hard dependency: no rotate/disable/create/reassign UI ships before lifecycle audit exists)**.
- **Acceptance.** Secret appears only in the reveal dialog and is cleared on close; disable dialog states irreversibility; reassign copy per §5.7.
- **Security.** No storage/URL/log of secrets; `delivery_connector.manage`/`reassign` enforced server-side and mirrored client-side; actions absent (not disabled) without permission.
- **Tests.** Secret-handling component tests; permission matrix; error-code mapping.
- **Excludes.** Provider connections, re-enable (GAP-4), remap.
- **5c acceptance criterion — create after an unknown outcome (owner decision 2026-10-14).** `POST /delivery-connectors` is not idempotent, so after a lost response the server may already have created the point (possibly hidden from the user by branch scope). 5c therefore: shows a neutral "could not be confirmed" notice and never infers failure from the point's absence; offers no retry control and never retries or rotates automatically; and **blocks re-sending the same platform + store ID in page memory only** (no `localStorage`/`sessionStorage`/IndexedDB/cookie), lifted only by the point itself appearing in a fresh list. **Known, temporary gap (deferred, not handled in 5c):** a hard reload, closing the tab, another tab or another device clears that protection; the server still answers 409 to a repeated create and never re-sends the secret. **Final fix chosen by the owner: backend idempotency on create (option C), as an independent follow-up** that changes the API contract — it is outside the 5c PR, and no browser-storage stopgap (options A/B) is added.

#### INT-ACT-1 — Attempts read API (backend, additive, sanitized)
- **Scope.** Paginated tenant- and branch-scoped read of attempts: id, time, short event id, outcome, error code, HTTP status, provider order id, hub order link, secret version. **Never** `operational_raw_body`.
- **Depends on.** None (a read of existing data). Closes GAP-2/GAP-9.
- **Acceptance.** Branch-restricted users see only attempts of visible accounts; foreign tenant ids 404; payload never present.
- **Security.** `delivery_connector.view`; field allow-list serializer; no checksum of raw body beyond a short prefix.
- **Tests.** Isolation (tenant/branch), payload-absence, pagination, SQLite + PostgreSQL.
- **Excludes.** Writes, replay actions, payload viewing.

#### INT-UX-6 — Activity & errors tab and error-code dictionary
- **Scope.** Screen 8 events log; Appendix C dictionary; filters; detail `Sheet`.
- **Depends on.** INT-ACT-1, INT-UX-4, INT-AUDIT-1 (done — the events are written) and, **for the configuration-change log only, the DP-E read-permission decision** (see below).
- **Acceptance.** Replays and `state_not_applied` labeled correctly; unknown codes show a neutral fallback plus the code.
- **Security.** Only allow-listed fields; localized text from dictionary, never raw server text.
- **Tests.** Dictionary completeness against the backend code list; RTL/LTR; stale-response handling like Hub UI. **For the audit reader (when it is built):** permission matrix (no read without the approved DP-E permission; finance roles denied by default); cross-tenant isolation (another tenant's events and ids are invisible / 404); branch-restricted users see only events of accounts on their branches; **unrouted** accounts' events are hidden from restricted users; both audit tables are covered; no secret, prefix, token or payload in any response; the reader is read-only (no write route).
- **Owns the audit reader (owner decision, 2026-10-14).** The read side of the connection-lifecycle audit — the *configuration-change log* (Screen 8's second log, §5.8) over `delivery_connector_lifecycle_events` and the existing `delivery_connector_operator_events` — belongs to **INT-UX-6**, not to INT-AUDIT-1. This replaces the earlier exclusion ("Configuration-change log (needs INT-AUDIT-1)"), which contradicted INT-AUDIT-1's own scope and left the reader without an owner. Allow-listed fields only (event code, actor, time, store/platform, secret *version* numbers) — never a secret, prefix, token or payload; tenant-scoped and branch-scoped like the connector list.
- **Deferred; not authorized.** Implementing the reader is **deferred until the read permission is approved under DP-E** (who may read lifecycle audit rows; finance roles must not gain visibility by default). **This edit assigns ownership only. It does not authorize starting INT-UX-6**, which still needs its own assignment (and INT-ACT-1 for the events log).
- **Excludes.** Writing audit events (INT-AUDIT-1, done); a new audit API contract is part of this slice's own design, not assumed here.

#### INT-AUDIT-1 — Connection-lifecycle audit *(DP-F approved 2026-10-14; implemented and merged — PR #1411, `af82fcb0`)*
- **Scope.** Append-only audit table and writers for ingress create/rotate/disable; reader for the activity tab's second log. **Delivered 2026-10-14: table + writers.** The reader was deferred by owner decision D4 and is **owned by INT-UX-6** (owner decision, 2026-10-14), implementation deferred until the DP-E read permission is approved; INT-AUDIT-1 is complete without it.
- **Depends on.** DP-F.
- **Acceptance.** No secrets/payloads recorded; model rejects update/delete; existing operator events remain valid.
- **Security.** Uuid user columns without FKs; tenant scoped.
- **Tests.** Append-only, completeness per action, isolation.
- **Excludes.** Backfill, provider events.

### Track P — Authentication and synchronization (all **blocked**)

| Task | Blocked by | Notes |
|---|---|---|
| **INT-P0 Evidence collection** (owner action) | Owner | The per-provider checklist in `DLV-PROVIDER-READINESS-1` §7. Nothing to build. |
| **INT-STATE-1 Connection model and state service** | DP-B (and DG-7), at least one provider with G1-G6 | Persistence of facts, derived state, transition validation (§6.3), audit hooks. |
| **DLV-HUNGERSTATION-1 / DLV-KEETA-1** (existing Horizon tasks) | G1-G6 for the provider | Provider authentication adapters terminating in the backend and producing the neutral envelope; each lands with its own manifest-flip PR (R-GATE-4). |
| **INT-AUTH-1 Authorization workflow UI** | INT-STATE-1, an adapter, manifest `connect_enabled` | Screen 4. |
| **INT-MAP-1 Store mapping UI/API** | INT-STATE-1, DP-A, DP-D | Screen 5. |
| **INT-SYNC-1 Sync start/pause/resume and health** | INT-STATE-1, INT-ACT-1 | Screen 6, T4-T9. |
| **INT-DISC-1 Reauthorize and disconnect** | INT-STATE-1, DP-A, DP-F | Screen 7, safe disconnect §5.7. |

Each Track P task, when promoted, must carry its own Scope / Dependencies / Acceptance / Security / Tests / Exclusions in a dedicated evidence-backed brief; this document fixes only the rules they inherit (§4, §6, §7). **Excluded from all tasks:** invoice/payment/journal/VAT/COGS/stock/settlement/commission/refund behavior, cancel/refund calls to providers, catalog and availability sync, and any provider enablement without the manifest-flip PR.

### Suggested order

`INT-READY-1` → `INT-UX-1` → `INT-UX-2` → `INT-UX-3` ⟶ (decide DP-C, DP-F) ⟶ `INT-ACT-1` → `INT-UX-4`/`6` → `INT-AUDIT-1` → `INT-UX-5`. *(Update 2026-10-14: `INT-AUDIT-1` is done; `INT-UX-6`'s configuration-change log now follows it and the DP-E read-permission decision.)* Track P starts only when an owner packet satisfies G1-G6 for one provider.

---

## 12. Reviews and honesty notes

### 12.1 Rejected / Not Adopted

| Option | Why rejected |
|---|---|
| One status badge ("Connected / Not connected") per platform | Collapses A-D; the Core has no such status; would mislead (R-LADDER). |
| Disabled/greyed Connect button with a tooltip | "No actual Connect buttons"; invites client-side bypass; implies imminence (R-GATE-1). |
| Mapping `DeliveryConnectorAccount.status = configured` to `CONNECTED` | It proves no provider credential or merchant identity (§6.4). |
| Absorbing `/delivery-platforms` into the Center | Redesigns a working subsystem; risks manual attribution (AD-1). |
| Putting Integrations under the `developer` group | Different audience and trust direction. |
| "Coming soon" badges or dates on providers or categories | Unsupported promises (R-COPY-3, R-CAT). |
| A "recommended provider" marker | Evidence recommends an *evidence track* only, not a product ranking. |
| Showing raw payloads or a "replay" button | Payload is encrypted/hidden by design; replay tooling is out of scope in Core. |
| Using green for "Connected" | `DESIGN_SYSTEM.md` reserves semantic green for financial meaning. |
| Self-service credential entry for providers without a verified auth method | Would invent API/OAuth support. |

### 12.2 Visual research

The Horizon protocol requires visual benchmarking for UI/UX work. **This task did not perform it and does not claim to.** It had no browsing of reference products and no screenshots. Layout decisions here derive from the repository's own design system, existing screens (`/delivery-platforms`, `/delivery-hub`, Settings, Developer) and the established table→cards, tabs and dialog patterns. Before `INT-UX-1` ships, run the visual benchmark (desktop + mobile, RTL + LTR, empty/error/permission states) and record it as External Evidence in that task's report. Any outcome that changes this document does so through a normal revision, not silently.

### 12.3 Design self-review

- No new external claim about any provider was introduced; every provider statement traces to `DLV-PROVIDER-READINESS-1`.
- No provider is shown as available, approved, connected or syncing.
- No endpoint, field, permission, or table is claimed that does not exist; every missing capability is a `GAP-n`.
- The three gate points (UI absence, server guard, invariant test) are independent.
- Financial behavior is untouched; the Center has no write path to profiles or financial roles.
- Dates, counts and states in UI copy are derived from data or omitted; none are promised.

### 12.4 AWJ Guardian review

| Risk | Result |
|---|---|
| Connect control reachable for an unreleased provider | Not rendered; server guard; invariant test. |
| `configured` read as "Connected" | Separate wording and panel; forbidden-word test. |
| Secret exposure in UI, URL, storage or logs | One-time dialog rules; no storage; code-dictionary errors; no payload display. |
| Cross-tenant oracle widened | Generic `mapping_ambiguous` text; no claim action; `DP-D` handled as a packet. |
| Branch leak | Restricted users see only accessible branches' connections; hidden unrouted accounts. |
| Silent rebind to another merchant on reauth | Identity must match, otherwise disconnect + new connection. |
| False revocation claim | Revoke wording tied to what the adapter actually did. |
| Hub order becoming an invoice | No such action or route; negative tests extended. |
| Misleading health ("all good") | Evidence-with-timestamp wording; no-event is not "Healthy". |
| Policy hard-coded where several answers are valid (Rule 6) | The gate is safety/evidence, not policy. Policy-like choices (sync auto-start, unrouted handling) default to the safest explicit option and are listed for configuration at their task, not decided here. |

### 12.5 Documentation consistency

- `DLV-CONNECTOR-CORE-1-IMPLEMENTATION-REPORT.md` still says "Not merged" in its header; it is historical and merged as PR #1287 per `DLV-PROVIDER-READINESS-1`. Not edited.
- `DLV-HUB-UI-1-IMPLEMENTATION-REPORT.md` says `logoSrc` is null for every key; later work committed official icons (`DELIVERY_PLATFORM_LOGO_PROVENANCE`). This document follows current code. Not edited.
- `PlatformIntegrations`/`platformIntegrations` strings belong to Document Center settings; the new namespace must be `integrationCenter`.

**Merge ≠ Deploy.** This PR is documentation only. No production release is authorized.

---

## Appendix A — Files reviewed

Backend: `app/Support/DeliveryPlatformCatalog.php`, `app/Models/DeliveryConnectorAccount.php`, `app/Models/DeliveryConnectorAttempt.php`, `app/Models/DeliveryHubOrder.php`, `app/Services/DeliveryHub/DeliveryConnectorAccountService.php`, `app/Services/DeliveryHub/DeliveryConnectorIngestionService.php` (outcome and error-code vocabulary), `app/Http/Controllers/Api/DeliveryConnectorAccountController.php`, `app/Http/Controllers/Api/DeliveryPlatformController.php` (catalog), `app/Http/Resources/DeliveryConnectorAccountResource.php`, `app/Support/Rbac.php`, `routes/api.php` (879-900, 1446), `database/migrations/2026_11_02_010000_create_delivery_connector_accounts_table.php`, `…_020000_create_delivery_connector_attempts_table.php`.

Web: `web/src/lib/delivery-platform-registry.ts`, `web/src/lib/delivery-platform-management.ts`, `web/src/lib/permissions.ts`, `web/src/components/layout/sidebar.tsx`, `web/src/components/layout/nav-visibility.ts`, `web/src/components/delivery-platforms/delivery-platforms-workspace.tsx`, `web/src/components/pos/pos-delivery-platform-picker.tsx`, `web/src/components/developer/secret-reveal.tsx`, `web/src/components/ui/badge.tsx`, `web/src/app/(app)/settings/page.tsx`, `web/src/messages/{ar,en}.json` (`deliveryPlatforms`, `nav`, `platformIntegrations`).

Docs: `CLAUDE.md`, `DESIGN_SYSTEM.md`, `design-system/patterns/states.md`, `design-system/layout/responsive.md`, `design-system/accessibility/standards.md`, `docs/plans/pos/AWJ_DELIVERY_PLATFORMS_HORIZON_V1.md`, `DLV-CONNECTOR-CORE-1-IMPLEMENTATION-REPORT.md`, `DLV-CONNECTOR-OWNERSHIP-1-DECISION-PACKET.md`, `DLV-PROVIDER-READINESS-1-REPORT.md`, `DLV-HUB-PROJECTION-1-IMPLEMENTATION-REPORT.md`, `DLV-HUB-UI-1-IMPLEMENTATION-REPORT.md`, `DLV-PLATFORM-MGMT-UI-1-IMPLEMENTATION-REPORT.md`, `DLV-CLOSE-1-IMPLEMENTATION-REPORT.md`.

## Appendix B — Provider facts used (verbatim from the evidence packet)

| Provider | Technical | Commercial | Financial/legal | Imported posting |
|---|---|---|---|---|
| HungerStation | OWNER_GATE | OWNER_GATE | BLOCKED | BLOCKED |
| Jahez | BLOCKED | OWNER_GATE | BLOCKED | BLOCKED |
| Mrsool | BLOCKED | OWNER_GATE | BLOCKED | BLOCKED |
| Keeta | OWNER_GATE | OWNER_GATE | BLOCKED | BLOCKED |
| Ninja | BLOCKED | OWNER_GATE | BLOCKED | BLOCKED |
| The Chefz | BLOCKED | OWNER_GATE | BLOCKED | BLOCKED |

Source: `DLV-PROVIDER-READINESS-1-REPORT.md` §1, verified 2026-10-11. Nothing is `READY`. This design does not re-verify or extend it.

## Appendix C — Error-code dictionary (UI text keyed by code)

Codes below exist in the backend today (`DeliveryConnectorIngestionService`, `DeliveryConnectorAccountService`, `DeliveryConnectorAccountController`). The implementing task must re-grep the code list at build time and fail a test when a code is missing from the dictionary.

| Code | Where | العربية | English |
|---|---|---|---|
| `invalid_signature` | ingestion | تعذّر التحقق من توقيع الحدث. | The event signature could not be verified. |
| `timestamp_expired` | ingestion | انتهت صلاحية توقيت الحدث. | The event timestamp is outside the allowed window. |
| `invalid_payload` | ingestion | محتوى الحدث غير صالح. | The event content is invalid. |
| `payload_conflict` | ingestion | يتعارض الحدث مع حدث سابق لنفس الطلب. | The event conflicts with an earlier event for the same order. |
| `mapping_mismatch` | ingestion | بيانات المتجر أو الفرع في الحدث لا تطابق الربط. | The store or branch in the event does not match the mapping. |
| `branch_unavailable` | ingestion/mgmt | الفرع غير متاح. | The branch is unavailable. |
| `profile_unavailable` | ingestion/mgmt | ملف المنصة غير متاح. | The platform profile is unavailable. |
| `tenant_unavailable` | ingestion | المؤسسة غير متاحة. | The organization is unavailable. |
| `actor_unavailable` | ingestion | لا يوجد مشغّل مؤهل لهذا الربط. أعد الإسناد. | No eligible operator exists for this connection. Reassign it. |
| `application_inactive` | ingestion | تطبيق نقاط البيع غير مفعّل. | The POS application is not enabled. |
| `subscription_inactive` | ingestion | الاشتراك غير فعّال. | The subscription is inactive. |
| `connector_disabled` | ingestion | نقطة الاستقبال معطّلة. | The ingress is disabled. |
| `state_not_applied` | ingestion | استُلم الحدث ولم تتغير حالة الطلب. | Event received; the order state was not changed. |
| `mapping_ambiguous` | mgmt | معرّف المتجر مربوط مسبقاً ولا يمكن إعادة استخدامه. إن كان متجرك فتواصل مع الدعم. | This store id is already mapped and cannot be reused. If it is your store, contact support. |
| `invalid_store` | mgmt | معرّف المتجر مطلوب. | A store id is required. |
| `branch_required` | mgmt | المستخدم المقيّد لا ينشئ ربطاً بلا فرع. | A branch-restricted user cannot create an unrouted connection. |
| `branch_inactive` | mgmt | الفرع غير نشط. | The branch is inactive. |
| `operator_ineligible` | mgmt | المستخدم المختار غير مؤهل. | The selected user is not eligible. |
| `connector_unavailable` | mgmt | الربط غير متاح. | The connection is unavailable. |
| `tenant_required` | mgmt | سياق المؤسسة مطلوب. | An organization context is required. |
| `provider_not_ready` *(proposed, INT-READY-1)* | future | هذا التكامل غير متاح بعد. | This integration is not available yet. |

Attempt outcomes (stored `outcome`): `accepted` and the failure/conflict outcomes written with an `error_code`; a repeated event is presented as `replay`. Exact outcome strings must be taken from the code at build time, not from this table.
