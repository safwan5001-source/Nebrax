# DLV-INTEGRATIONS-UX-DESIGN-1 — Implementation handoff

**Task:** `DLV-INTEGRATIONS-UX-DESIGN-1` (documentation only)
**Full specification:** `docs/plans/pos/DLV-INTEGRATIONS-UX-DESIGN-1.md`
**Status:** PR open for review. Not merged. Not deployed.

## 1. Identity

| Item | Value |
|---|---|
| Base SHA (`origin/main` at start) | `71cf6396728bbc65ea0921a7afee25b3945e5189` |
| Content SHA (commit that added the two documents) | `fb90c7e97adbbb7261935012a677824c2ac31d4c` |
| Head SHA | The PR head. A later commit may only update this table; the PR page is authoritative. |
| Branch | `docs/dlv-integrations-ux-design-1` |
| PR | #1380 (https://github.com/safwan5001-source/Nebrax/pull/1380) |
| PRE_MERGE_REVIEW | **Not stamped.** Documentation-scope result to be recorded after CI on the exact Head SHA. |

## 2. One-paragraph summary

A unified `Settings → Integrations` Integration Center is specified for Delivery Platforms (E-commerce, Payment Gateways, Shipping Providers appear only as non-interactive "planned" text). It is a truth layer over the existing subsystems (platform profiles, POS attribution, Delivery Hub, channel report, Connector Core) and does not replace any of them. It separates four facts that must never share one badge: **A** manual POS attribution (per tenant), **B** native integration available and approved (per platform), **C** connected merchant account with verified credentials, **D** active order sync. Today B is false for all six platforms, so C and D are structurally unavailable and no Connect control exists.

## 3. Existing files reviewed

Backend: `DeliveryPlatformCatalog`, `DeliveryConnectorAccount` / `Attempt` / `OperatorEvent` models, `DeliveryConnectorAccountService`, `DeliveryConnectorIngestionService` (vocabulary), `DeliveryConnectorAccountController`, `DeliveryPlatformController::catalog`, `DeliveryConnectorAccountResource`, `Rbac`, `routes/api.php` (delivery sections), connector migrations.

Web: `delivery-platform-registry.ts`, `delivery-platform-management.ts`, `permissions.ts`, `sidebar.tsx`, `nav-visibility.ts`, `delivery-platforms-workspace.tsx`, `pos-delivery-platform-picker.tsx`, `secret-reveal.tsx`, `badge.tsx`, Settings page, `ar.json` / `en.json` (`deliveryPlatforms`, `nav`, `platformIntegrations`).

Docs: `CLAUDE.md`, `DESIGN_SYSTEM.md`, `design-system/{patterns/states,layout/responsive,accessibility/standards}.md`, Horizon V1, `DLV-CONNECTOR-CORE-1`, `DLV-CONNECTOR-OWNERSHIP-1`, `DLV-PROVIDER-READINESS-1`, `DLV-HUB-PROJECTION-1`, `DLV-HUB-UI-1`, `DLV-PLATFORM-MGMT-UI-1`, `DLV-CLOSE-1`. Full list: spec Appendix A.

## 4. Design decisions

| ID | Decision |
|---|---|
| AD-1 | Reuse, do not absorb: `/delivery-platforms`, `/delivery-hub`, POS and the channel report stay where they are; the Center links to them. |
| AD-2 | Four-step ladder A/B/C/D with strict dependency `D ⇒ C ⇒ B`; C/D print "unavailable until a native integration exists", never a zero or healthy-looking empty state. |
| AD-3 | Provider readiness becomes a backend-owned, non-tenant manifest (derived from the evidence packet) with `connect_enabled` and a separate `sync_enabled` kill switch; **today all `false`**. |
| AD-4 | Three independent safeguards for Connect: control **not rendered**, server guard `409 provider_not_ready`, permanent invariant test. A manifest flip is its own PR. |
| AD-5 | The ten requested states are UX states with a transition table; only `DISCONNECTED` has a partial backend analog (`status = disabled`). `configured` is never "Connected". |
| AD-6 | Connecting and starting sync are two explicit decisions; success copy never says orders are syncing. |
| AD-7 | Health is evidence with timestamps ("last event 2 min ago"), never "Healthy/Live/Synced". |
| AD-8 | Navigation: one entry in the sidebar `settings` group (`/integrations`), no new permission; per-category access decided inside the page. Not under `developer`. |
| AD-9 | Namespace for strings: `integrationCenter` (the `platformIntegrations` namespace belongs to Document Center settings). |

## 5. Decision Packets raised (not decided, not implemented)

| ID | Question | Recommendation in spec |
|---|---|---|
| **DP-A** | Mapping is immutable, store id globally unique and reserved forever, and there is no re-enable route: how are reconnect and branch re-home handled? | Guarded, audited re-enable first; re-home only with an open-order policy; never release store ids. |
| **DP-B** | Storage and lifecycle of provider tokens and connection state (DG-7 still open). | Decide DG-7 first; separate tenant-scoped connection entity; state derived, not a new enum. |
| **DP-C** | Should AWJ-signed ingress accounts appear in the tenant UI? | Read-only panel with explicit "not a platform connection" wording; full management later. |
| **DP-D** | Uniqueness of a provider merchant account across tenants. | Global unique for active connections with the same generic error. |
| **DP-E** | Finance roles seeing connection health (permissions are owner/admin only). | Keep owner/admin now. |
| **DP-F** | Rotate/disable are unaudited. | One append-only lifecycle audit table before lifecycle UI. |

## 6. Gap register (things the design needs that do not exist)

GAP-1 no machine-readable readiness / server gate · GAP-2 no attempts read API · GAP-3 no lifecycle audit · GAP-4 no re-enable path · GAP-5 immutable mapping, reserved store id · GAP-6 no health model · GAP-7 no storage for provider tokens (DG-7) · GAP-8 no merchant-account uniqueness · GAP-9 Hub rows carry no source marker. Detail and resolution paths: spec §1.3.

## 7. Unresolved provider dependencies

Unchanged from `DLV-PROVIDER-READINESS-1`; nothing is `READY`. This task did no new provider research.

| Provider | Technical | What the owner must still obtain |
|---|---|---|
| HungerStation | OWNER_GATE | Named merchant agreement; confirmation of which surface applies (Delivery Hero POS plugin, HungerStation Partner API/Pelican, other); indirect vs direct flow approval; frozen spec with its authentication section; issued test vendor and non-production credentials; store-id mapping rule; Hub-only written limit. |
| Keeta | OWNER_GATE | Written KSA applicability; signed NDA; developer account and test store; one chosen webhook registration method; worked inbound signature example; confirmation of the store key (`shopId` vs `merchantId`); Hub-only written limit. |
| Jahez | BLOCKED | Official API/partner contract or a written statement that none will be issued. |
| Mrsool | BLOCKED | Official restaurant integration contract. |
| Ninja | BLOCKED | Merchant agreement and integration contract with the legal entity (legal-name wording to be confirmed). |
| The Chefz | BLOCKED | Official POS/partner API specification plus merchant agreement. |

Financial and imported-order posting stay `BLOCKED` for all six and are outside this design (`DG-3-*`, `DG-6-TRIGGER`, commission/settlement/reconciliation/refund tasks).

## 8. Files changed

| File | Change |
|---|---|
| `docs/plans/pos/DLV-INTEGRATIONS-UX-DESIGN-1.md` | Added |
| `docs/plans/pos/DLV-INTEGRATIONS-UX-DESIGN-1-HANDOFF.md` | Added |

No application code, migration, route, permission, translation file, workflow, or test file was touched.

## 9. Tests / verification performed

| Check | Result |
|---|---|
| `git diff --name-only origin/main...HEAD` lists only the two documents above | Passed |
| All 41 repository paths cited in the spec exist at the base SHA (scripted check; the only non-path match was the `{ar,en}.json` brace shorthand) | Passed |
| Claims about existing behavior re-verified against code: store-id uniqueness and mapping immutability, absence of an enable/re-enable route, absence of a web UI for `delivery-connectors`, resource omits secret, attempts `operational_raw_body` hidden, branch-restricted listing excludes unrouted accounts, rotate/disable write no audit event, routes and permission names, sidebar structure | Passed |
| Error-code appendix cross-checked against codes present in the ingestion and account services/controller | Passed (the implementing task must re-grep; exact `outcome` strings are deliberately not frozen here) |
| PHP or web test suites | **Not run.** Documentation-only change; no code path is affected. |
| Visual/competitor benchmarking (Horizon mandatory for UI work) | **Not performed and not claimed.** Required before `INT-UX-1` ships (spec §12.2). |

## 10. Build / CI status

Recorded on the PR for the exact Head SHA. `CI` (`ci.yml`, sqlite + pgsql) runs on every push/PR; `web-ci.yml` is path-filtered to `web/**` and is not expected to trigger for this change. At the time of writing, the `sqlite` and `pgsql` jobs on content SHA `fb90c7e` were in progress; the final result must be read from the PR checks, not from this file.

## 11. Risks

| Risk | Mitigation in the design |
|---|---|
| The Center is mistaken for a working integration | Ladder, no Connect control, forbidden-word rules, `configured` separated from "Connected". |
| `mapping_ambiguous` becomes a cross-tenant oracle | Generic copy, no claim action; `DP-D` recorded. |
| Reconnect/remap impossible with today's immutability | Stated in the UI up front; `DP-A` before any reconnect UX. |
| Provider changes terms or withdraws access | Separate `sync_enabled` kill switch and `provider_not_ready` guard. |
| Tokens need rotation, unlike the write-once ingress secret | `DP-B` before any authorization task. |
| No lifecycle audit today | `DP-F` before lifecycle UI. |
| Visual benchmark outstanding | Gate on `INT-UX-1`. |
| Logos could imply partnership | Copy rules R-COPY-3; no partner badges. |

## 12. Next recommended task

**`INT-READY-1`** (backend, additive): the readiness manifest with all six providers `connect_enabled = false`, derived UX states, a read-only endpoint, and the `provider_not_ready` guard. It is small, touches no tenant data, and is the single dependency for the catalog UI. Then `INT-UX-1` → `INT-UX-2` → `INT-UX-3` (spec §11). Parallel owner action: collect the per-provider evidence in `DLV-PROVIDER-READINESS-1` §7, starting with HungerStation (alternate track: Keeta). Do not start any adapter, commission, settlement or imported-order work.

**Merge ≠ Deploy.** No production release is authorized.
