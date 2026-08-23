# NEBRAX ERP — FUEL STATIONS MANAGEMENT
## MASTER EXECUTION PROMPT

> **Purpose:** This prompt is the execution contract for building the Fuel Stations Management product inside Nebrax ERP.
> **Primary source of truth:** `FUEL_STATIONS_MASTER_PLAN.md`
> **Design source of truth:** `DESIGN_SYSTEM.md`
> **Repository source of truth:** the latest `main` branch and the existing implementation/tests.
> **Execution model:** multi-cycle, production-grade, test-driven, tenant-safe, workspace-ready, integration-ready.

---

# 0. NON-NEGOTIABLE EXECUTION CONTRACT

You are implementing a production-grade Fuel Stations Management platform inside the existing Nebrax ERP repository.

Do **not** treat this as a simple POS feature or a lightweight CRUD module.

The target is a complete:

**Fuel Retail + Station Operations + Fleet Fueling + Smart AVI/RFID + Forecourt/ATG Integration Platform**

integrated with Nebrax accounting, invoicing, ZATCA, application entitlement, tenant isolation, RBAC, audit, and the Nebrax design system.

The implementation must be capable of supporting:

- One station
- Multi-station operators
- Corporate fuel customers
- Fleet contracts
- Vehicles and drivers
- Fuel cards
- RFID / AVI smart fueling
- Tanks and fuel inventory
- Pumps and nozzles
- Forecourt controllers
- ATG tank gauges
- Payment terminals
- External fuel-card/payment providers
- Offline/store-and-forward operation
- Maintenance
- Safety
- Accounting
- ZATCA
- Operational and management reporting

The hardware-specific integrations may be deferred until actual vendors/devices are selected, but the architecture required to support them is **not optional** and must be built from the beginning.

---

# 1. FIRST ACTION — PREFLIGHT ONLY

Before changing code:

1. Fetch/inspect the latest `main`.
2. Record the current full `main` SHA.
3. Confirm the working tree is clean.
4. Confirm the Git remote and publication path are functional.
5. Confirm you can:
   - create branches,
   - commit,
   - push,
   - create PRs,
   - run backend tests,
   - run PostgreSQL-path tests,
   - run frontend lint/type/build checks,
   - observe CI results.
6. Read, at minimum:
   - `FUEL_STATIONS_MASTER_PLAN.md`
   - `DESIGN_SYSTEM.md`
   - `CLAUDE.md` if present
   - relevant platform/application/entitlement code
   - tenancy and RBAC implementation
   - accounting engine
   - invoice/ZATCA engine
   - branch/company models
   - inventory implementation
   - POS implementation
   - existing settings architecture
   - audit/event conventions
7. Inspect the real code before choosing exact class/table/component names.

### Hard stop
If `FUEL_STATIONS_MASTER_PLAN.md` is missing, do not reconstruct its scope from memory or silently shrink the product. Report the missing source-of-truth document.

If Git publication, tests, or the execution environment are materially unavailable, report the exact limitation before implementation.

---

# 2. SOURCE-OF-TRUTH PRIORITY

When sources conflict, use this order:

1. Existing safety/security/accounting invariants that protect production correctness
2. `FUEL_STATIONS_MASTER_PLAN.md`
3. Existing Nebrax architecture and established domain conventions
4. `DESIGN_SYSTEM.md`
5. This execution prompt
6. Agent preferences

Do not silently rewrite prior architectural decisions.

If a genuine contradiction exists, stop only for that concrete decision and explain:
- the conflict,
- affected files/domains,
- safest options,
- recommended choice.

---

# 3. COMPLETENESS RULE

Every confirmed requirement in `FUEL_STATIONS_MASTER_PLAN.md` belongs to the product.

A requirement is not allowed to disappear because:
- it is not convenient in the current cycle,
- it is not shown in a mockup,
- a device vendor is not yet known,
- a UI screen is not yet built,
- the agent considers it “future work”.

If a requirement cannot be completed in the current cycle, it must be recorded explicitly as:

- `DEFERRED`
- reason
- dependency/blocker
- target cycle or future integration phase
- architectural preparation completed now

No silent omissions.

---


# 3A. COMMERCIAL APPLICATION / ADD-ON CONTRACT

Fuel Stations must be implemented as an optional commercial application inside the existing Nebrax application platform.

The required access chain is:

**Application Catalog / Capabilities  
→ Commercial Entitlement  
→ Tenant Application State  
→ RBAC  
→ Backend Enforcement  
→ Workspace / UI**

### Commercial identity

Use a stable primary commercial product identity such as:

`fuel-stations`

unless the existing repository has a stricter naming convention that requires an equivalent stable key.

The default commercial strategy is to sell/manage Fuel Stations as **one commercial product/add-on**, not as many small paid products.

It may be:
- assigned as an add-on,
- included in a plan,
- granted as a trial,
- covered by an approved legacy entitlement,
- cancelled,
- revoked,
- expired,
- or degraded according to the shared commercial entitlement lifecycle.

Do not create a separate Fuel-Stations-specific billing/entitlement lifecycle when the platform already provides one.

### Technical capabilities

Technical capabilities may include:

- `fuel_stations.core`
- `fuel_stations.inventory`
- `fuel_stations.forecourt`
- `fuel_stations.fleet`
- `fuel_stations.avi`
- `fuel_stations.maintenance`
- `fuel_stations.integrations`

Refine only if repository inspection shows a better capability decomposition.

These capabilities are primarily technical authorization/packaging units. They must not automatically be exposed as separate paid add-ons.

### Separation of concerns

Never collapse these layers:

- Commercial entitlement answers whether the tenant is commercially entitled.
- TenantApplicationState answers whether the tenant has chosen/enabled/suspended the application operationally.
- RBAC answers whether the current user may perform the requested action.
- Backend enforcement makes the actual access decision.
- Workspace/navigation only presents the authorized state.

Do not store commercial lifecycle in `TenantApplicationState`.

Do not use feature flags or navigation visibility as entitlement.

### Settings → Applications

Integrate Fuel Stations into the existing Applications commercial experience.

Where supported by the current platform, the application should be capable of representing:

- Included
- Add-on
- Trial
- Not available
- Effective FULL
- Effective READ_ONLY
- Effective DENIED
- Operational Enabled
- Operational Disabled
- Operational Suspended

Appropriate CTA behavior may include activation, trial start, purchase/request, enable, disable, or resume according to platform rules and user authority.

The UI is never authoritative.

### Workspace exposure

Fuel Stations is intended to expose a dedicated workspace when effectively entitled and operationally enabled.

However:

**workspace visibility is not authorization.**

Protected backend routes/actions must reject direct access when entitlement/state/RBAC/backend enforcement does not allow the operation.


# 4. ARCHITECTURAL PRINCIPLES

Preserve these boundaries:

**Application Catalog / Capabilities  
→ Commercial Entitlement  
→ Tenant Application State  
→ RBAC  
→ Backend Enforcement  
→ Presentation / Workspace**

Fuel Stations must integrate with this architecture; do not create a parallel entitlement/security system.

Also preserve:

**Operational Domain  
↔ Accounting Engine  
↔ Invoice/ZATCA Engine**

Do not create duplicate accounting or invoice engines.

For devices:

**Device  
→ Driver  
→ Adapter  
→ Normalized Event  
→ Fuel Station Domain**

Do not couple core fuel business logic to a specific manufacturer.

For configuration:

**System Default  
→ Tenant  
→ Station  
→ Device/Terminal Override**

Support inheritance and controlled overrides where appropriate.

---

# 5. DATA OWNERSHIP AND TENANT SAFETY

Every new domain object must have clearly defined ownership.

At minimum:
- tenant scope for all tenant-owned data,
- station scope for station operational records where appropriate,
- branch/company mapping only through validated tenant-owned references.

Never accept a tenant or station identifier from a request and trust it without ownership validation.

Prevent:
- cross-tenant lookup,
- cross-station mutation,
- foreign relation injection,
- IDOR,
- unsafe route-model binding,
- accidental global queries.

Backend is authoritative. Navigation/UI hiding is never security.

Add tests proving tenant isolation and station isolation.

---

# 6. SETTINGS ARE FIRST-CLASS PRODUCT FUNCTIONALITY

Do not hard-code operational behavior that belongs in settings.

Every cycle must identify and implement its relevant settings at the same time as the feature.

Settings must cover, where applicable:

- operational day
- timezone
- units
- numbering
- fuel products
- rounding
- fuel pricing
- price approvals
- tank thresholds
- safe capacity
- reconciliation tolerance
- inventory adjustment policy
- pump timeout
- forecourt authorization mode
- ATG polling/reconciliation
- shift opening/closing requirements
- mandatory readings
- shift variance thresholds
- discounts
- void/refund rules
- credit sale rules
- payment methods
- terminal mapping
- settlement behavior
- fleet restrictions
- AVI/RFID rules
- offline authorization
- receiving tolerance
- required receiving documents
- credit limits
- account blocking
- cash float/limits
- shortage approval
- expense approval
- maintenance intervals
- safety check schedules
- notification/escalation
- GL/accounting mappings
- integration provider configuration
- device mappings
- retry/health policies
- reporting cutoff and measurement basis

Critical settings changes must be audited with:
- before
- after
- changed_by
- changed_at
- tenant
- station
- device if relevant
- reason where required

---

# 7. UI / UX CONTRACT

Apply `DESIGN_SYSTEM.md` throughout.

Mandatory behavior:
- RTL-first
- Arabic-first but English-mirror-ready
- mobile compatibility
- dense, efficient ERP layout
- clear financial hierarchy
- tables as primary operational surfaces where appropriate
- IBM Plex Sans Arabic for UI where the existing system uses it
- IBM Plex Mono for money, quantities, codes, meters where appropriate
- design tokens instead of raw hex values
- no gradients
- no heavy shadows
- no decorative colored icon boxes
- accessible semantic states
- loading states
- empty states
- error states
- permission-denied states
- offline/syncing states where relevant

Fuel Stations should be a dedicated workspace if the existing architecture supports workspace presentation, while authorization remains independent of presentation mode.

### Workspace navigation target

**Overview**
- Dashboard

**Operations**
- Shifts
- Sales
- Pumps
- Tanks

**Fuel**
- Inventory
- Supplies
- Stocktake
- Reconciliation

**Customers & Fleet**
- Customers
- Vehicles
- Drivers
- Fuel Cards
- RFID / AVI

**Maintenance & Safety**
- Maintenance
- Assets
- Inspections
- Incidents

**Reports**
- Operations
- Sales
- Inventory
- Profitability
- Fleet
- Devices

**Settings**
- Stations
- Fuel
- Tanks
- Pumps
- Shifts
- Payments
- Fleet
- Devices
- Integrations
- Accounting
- Notifications

Do not expose unfinished navigation that only leads to broken/403/placeholder experiences unless the system already has a deliberate “coming soon” convention.

---

# 8. MOBILE OPERATIONS

Do not design Fuel Stations as desktop-only.

Mobile workflows must support at least:
- open shift
- close shift
- meter reading
- tank reading
- receive fuel delivery
- upload delivery evidence/photo
- quick station expense
- safety inspection
- maintenance report
- approve variance where permitted
- view urgent stock/device alerts

Use appropriate mobile patterns such as sticky/bottom actions where they improve operational speed.

---

# 9. FINANCIAL AND INVENTORY INVARIANTS

Never treat ATG reading as the accounting balance.

Maintain clear separation of:
- Book Stock
- Physical Stock
- ATG Stock

Inventory reconciliation must support:

Opening  
+ Deliveries  
- Sales  
± Transfers  
± Approved Adjustments  
= Expected Closing

Then compare against physical/ATG evidence.

Variance must be explicit:
- liters
- percentage
- financial impact
- tolerance status
- approval status
- accounting treatment

Approved/closed shifts must not be silently edited. Corrections must use controlled adjustment/correction workflows with audit history.

Cash shortages/overages and fuel losses/gains must not silently disappear.

---

# 10. DEVICE AND INTEGRATION PRINCIPLES

Architect from day one for:
- Forecourt controllers
- Pump controllers
- ATG
- RFID readers
- Card readers
- Payment terminals
- Station gateways
- External fleet/fuel-card providers
- QR workflows

Use abstractions such as:
- VehicleIdentificationProvider
- FuelAuthorizationProvider
- ForecourtAuthorizationAdapter
- ForecourtDriver
- AtgDriver
- PaymentProviderAdapter

Exact names may follow existing repository conventions.

Core domain logic must consume normalized internal commands/events, not vendor payloads.

---

# 11. DEVICE REGISTRY

Provide a proper device registry capable of representing:
- tenant
- station
- device type
- manufacturer
- model
- serial
- firmware
- protocol
- endpoint/network metadata
- external identifier
- driver/adapter
- credential reference
- last seen
- health
- sync state
- installation/retirement state

Do not store raw secrets carelessly.

Device authentication must be separate from ordinary human-user authentication.

Never use one shared credential/token across all stations.

---

# 12. OFFLINE / STORE-AND-FORWARD

Offline operation is mandatory architectural scope.

Design for a future Station Edge Gateway / Local Agent.

Offline event model must support:
- globally unique event ID
- device/source identity
- sequence number where needed
- source timestamp
- checksum/signature where needed
- correlation ID
- sync state
- retry metadata

Must handle:
- idempotency
- replay protection
- duplicate prevention
- reconnect recovery
- conflict detection
- ordered processing where required
- dead-letter / failed-event visibility

A station must not be architecturally dependent on uninterrupted internet.

---

# 13. RFID / AVI IS CORE SCOPE

Do not reduce RFID/AVI to a payment method.

Build it as a fuel authorization system.

Support architecture for:
- vehicle RFID tag
- driver card
- vehicle + driver dual identification
- QR
- PIN
- odometer verification

Authorization should be capable of validating:
- customer contract
- vehicle status
- driver status
- permitted fuel
- permitted station
- daily/weekly/monthly liter limits
- daily/weekly/monthly value limits
- transaction count limits
- allowed time window
- minimum refill interval
- vehicle tank capacity
- odometer anomalies
- suspended/lost/blacklisted identifiers

Include anti-fraud signals and explicit denial reasons.

---

# 14. GIT / DELIVERY MODEL

Execute sequential cycles.

For **each cycle**:

1. Start from the latest merged `main`.
2. Create a fresh branch.
3. Implement the full cycle scope.
4. Use multiple logical commits.
5. Run targeted tests during development.
6. Run required regression suites before PR.
7. Push branch.
8. Create one PR for the cycle.
9. Wait/check CI.
10. Fix failures.
11. Merge only when required checks are green.
12. Refresh from the newly updated `main`.
13. Begin the next cycle on a new branch.

Do **not** continue the next cycle on the previous merged branch.

Do not wait for user approval between cycles when:
- scope is already defined,
- tests are green,
- no business/architectural decision is missing.

Stop only for:
- real architecture contradiction,
- missing business rule that cannot be inferred safely,
- destructive migration risk,
- tenant/security regression,
- accounting integrity uncertainty,
- environment/tool publication failure.

---

# 15. BRANCH NAMES

Use clear names such as:

- `fuel-stations-cycle-0-foundation`
- `fuel-stations-cycle-1-master-data`
- `fuel-stations-cycle-2-inventory`
- `fuel-stations-cycle-3-supply`
- `fuel-stations-cycle-4-shifts`
- `fuel-stations-cycle-5-sales-payments`
- `fuel-stations-cycle-6-fleet`
- `fuel-stations-cycle-7-avi-rfid`
- `fuel-stations-cycle-8-integrations`
- `fuel-stations-cycle-9-readiness`

If repository conventions require another pattern, follow the established convention consistently.

---

# 16. CYCLE 0 — ARCHITECTURE & DOMAIN FOUNDATION

## Objective
Create the durable foundation without prematurely implementing vendor-specific hardware.

## Required work
- Inspect existing module/application architecture.
- Register Fuel Stations as the optional commercial application/add-on `fuel-stations` (or repository-equivalent stable key) using the existing entitlement architecture; support plan inclusion, add-on assignment, trial, cancellation/revocation/expiry, and shared lifecycle semantics without creating a parallel commercial state machine.
- Define technical capabilities only where justified.
- Establish domain boundaries.
- Establish tenant/station ownership rules.
- Establish settings hierarchy/foundation.
- Establish audit conventions.
- Establish normalized device/integration contracts.
- Establish domain event conventions.
- Establish workspace route/navigation shell without insecure gating.
- Add migrations/models/services only after aligning with existing repo conventions.

## Foundation entities/concepts
At minimum evaluate and model:
- FuelStation
- FuelProduct
- Tank
- TankCompartment if needed
- Pump
- Nozzle
- Shift
- Station role/scope mapping if required
- Device
- normalized integration event concepts
- settings ownership/overrides

## Acceptance
- Tenant/station ownership is explicit.
- Entitlement and RBAC integrate with existing platform.
- Settings can inherit/override appropriately.
- No vendor coupling.
- No duplicate accounting/invoicing engine.
- Architecture documentation updated.
- Tests pass.

---

# 17. CYCLE 1 — STATIONS, TANKS, PUMPS & MASTER DATA

Implement production-grade management for:

## Stations
- name
- code
- branch/accounting mapping
- location
- GPS
- city/region
- manager
- hours
- timezone
- operational status
- license data
- ZATCA-relevant mapping
- default accounting mappings

## Fuel products
Not hard-coded.
Support product/unit/density/tax/inventory/accounting mapping.

## Tanks
- capacity
- safe capacity
- minimum level
- dead stock
- fuel product
- opening stock
- measurement configuration
- ATG mapping placeholder/contract
- calibration
- status

## Pumps / nozzles
- station
- pump number
- tank mapping
- nozzle
- fuel product
- meter
- controller mapping
- operational state

## Frontend
Build complete CRUD/management UX consistent with Nebrax design system.

## Acceptance
No orphan mappings, no cross-tenant relations, validated station ownership, settings included, mobile-safe layouts.

---

# 18. CYCLE 2 — FUEL INVENTORY & TANK MANAGEMENT

Implement:
- inventory movement model/ledger appropriate to existing Nebrax inventory architecture
- opening
- delivery
- sale
- transfer
- adjustment
- loss
- gain
- evaporation
- stocktake
- reconciliation
- costing integration

Maintain separate:
- book stock
- physical stock
- ATG evidence

Implement:
- tank readings
- reconciliation
- tolerance rules
- approvals
- adjustment workflow
- audit

## Acceptance
Reconciliation mathematics is deterministic and tested.
ATG cannot overwrite book stock.
Approved adjustments are audited.
Tenant/station isolation is covered.

---

# 19. CYCLE 3 — SUPPLY & FUEL RECEIVING

Implement fuel procurement/receiving integration without duplicating the general purchasing engine unnecessarily.

Support:
- supplier
- purchase reference/order
- station
- fuel product
- target tank
- tanker
- driver
- compartments
- supplier delivery note
- dispatched liters
- received liters
- temperature
- density
- seal numbers
- before/after physical reading
- before/after ATG reading
- transit variance
- attachments/evidence
- approval
- supplier invoice matching where supported

## Acceptance
Receiving variance is explicit.
Inventory movement is correct.
Duplicate receipt is prevented.
Accounting/purchasing integration is safe.
Mobile receiving flow works.

---

# 20. CYCLE 4 — SHIFT & FORECOURT OPERATIONS

Implement full shift lifecycle:

## Opening
- cashier
- attendants/staff
- opening cash
- opening pump meters
- opening tank readings
- active terminals/devices

## During shift
- fuel transactions
- payments
- expenses
- cash movement
- device/forecourt events as available

## Closing
- closing meters
- liters sold
- expected sales
- payment totals
- cash count
- shortage/overage
- tank reconciliation
- supervisor approval

## Locking
After approval, normal direct mutation is forbidden.
Use correction/adjustment workflows.

## Acceptance
A shift must be testable end-to-end:
open → operate → sell → reconcile → count cash → close → approve → lock → controlled correction.

Concurrency and double-close cases must be tested.

---

# 21. CYCLE 5 — POS, PAYMENTS & FUEL SALES

Reuse Nebrax POS/payment/invoice components where appropriate, but model fuel-specific behavior correctly.

Fuel transaction and payment transaction must be separate concepts.

Support payment modes:
- cash
- bank card
- corporate credit
- fuel card
- RFID/AVI authorized account
- QR
- voucher
- employee account if allowed
- external fleet provider

Fuel transaction should capture, as applicable:
- station
- shift
- pump
- nozzle
- product
- start meter
- end meter
- liters
- price
- total
- vehicle
- driver
- authorization
- customer
- invoice
- external refs

Implement:
- void policy
- refund policy
- payment settlement state
- failure/retry
- audit
- ZATCA/invoice integration

## Acceptance
Sale/payment failure states are not conflated.
Duplicate transaction finalization is prevented.
Accounting and invoice outputs reconcile with the sale.

---

# 22. CYCLE 6 — CORPORATE CUSTOMERS, FLEET & FUEL CARDS

Reuse existing customer architecture where possible.

Implement:
- corporate fuel contracts
- credit limits
- payment terms
- station restrictions
- fuel restrictions
- special pricing
- monthly/consolidated billing
- vehicles
- drivers
- cost centers
- odometer
- fuel history

Fuel cards:
- customer
- vehicle
- driver
- cost center
- active/suspended/cancelled/replaced
- liters/value limits
- time limits
- transaction limits
- station/fuel restrictions
- history

## Acceptance
Policy enforcement must be backend authoritative.
Credit and usage limits must be tested.
No cross-customer vehicle/card leakage.

---

# 23. CYCLE 7 — AVI / RFID SMART FUELING

Implement the Fuel Authorization Engine and vendor-neutral identity layer.

Support:
- vehicle tag
- driver card
- dual verification
- QR/PIN fallback architecture
- odometer policy
- customer contract
- fuel/station/time limits
- amount/liter limits
- transaction frequency
- vehicle capacity sanity
- suspension/blacklist

Produce explicit authorization outcomes and reason codes.

Add fraud/suspicion signals:
- duplicate identifier
- wrong fuel
- refill too soon
- quantity beyond capacity
- anomalous odometer
- unusual station usage
- repeated denial pattern

## Acceptance
Authorization decisions are deterministic, auditable, testable, tenant-safe, and independent of any one RFID vendor.

---

# 24. CYCLE 8 — FORECOURT, ATG & DEVICE INTEGRATION PLATFORM

Implement the production-ready integration foundation.

## Device Registry
Include lifecycle, health, last seen, driver, manufacturer/model/protocol metadata, credential references, station ownership.

## Forecourt
Create vendor-neutral driver/adapter contracts and normalized events.

## ATG
Create vendor-neutral driver/adapter contracts and normalized reading/alarm model.

## RFID reader
Integrate with the identity/authorization layer through adapters.

## Payment terminal/provider
Prepare provider adapter contracts without duplicating payment domain logic.

## Offline
Implement or fully establish store-and-forward contracts:
- idempotency
- sequence
- replay prevention
- retry
- failure visibility
- reconnect recovery

## Fake drivers
Provide test doubles such as:
- FakeForecourtDriver
- FakeAtgDriver
- FakeRfidDriver

## Acceptance
A simulated external device event can enter through an adapter and produce the correct normalized domain behavior without vendor-specific logic leaking into the core domain.

---

# 25. CYCLE 9 — MAINTENANCE, SAFETY, ACCOUNTING, REPORTS & PRODUCTION READINESS

## Maintenance
Assets:
- pumps
- nozzles
- tanks
- ATG
- controllers
- generators
- compressors
- terminals
- RFID readers
- other equipment

Workflows:
- preventive
- corrective
- work orders
- schedules
- vendors
- spare parts if consistent with existing inventory architecture
- downtime
- cost
- fault history

## Safety
- inspections
- checklists
- extinguishers/emergency systems
- leaks
- incidents
- corrective actions
- permits/certificates
- expiry alerts
- attachments
- escalation

## Accounting
Integrate:
- fuel sales
- COGS
- inventory
- supplier receiving
- approved loss/gain
- shift shortage/overage
- AR/customer billing
- settlement

## ZATCA
Reuse existing Nebrax Invoice/ZATCA engine.

## Dashboards
Station dashboard:
- sales today
- liters
- margin
- stock
- tank days remaining
- open shifts
- cash variance
- deliveries
- pump availability
- alerts

Multi-station command center:
- station comparison
- sales
- liters
- margin
- inventory
- variance
- downtime
- alerts

## Reports
At minimum:
- sales by station/fuel/pump/nozzle/shift/employee/payment/customer/vehicle
- fuel movement/reconciliation
- profitability
- fleet usage
- AVI/RFID authorization/denial/suspicion
- device health/uptime/faults
- maintenance
- safety/compliance

---

# 26. OBSERVABILITY

Use structured operational events/logs.

Examples:
- FUEL_SHIFT_OPENED
- FUEL_SHIFT_CLOSED
- FUEL_SHIFT_VARIANCE
- FUEL_TANK_VARIANCE
- FUEL_DEVICE_OFFLINE
- FUEL_DEVICE_ONLINE
- FUEL_AVI_DENIED
- FUEL_AVI_APPROVED
- FUEL_ATG_SYNC_ERROR
- FUEL_FORECOURT_SYNC_ERROR
- FUEL_PAYMENT_SETTLEMENT_ERROR
- FUEL_OFFLINE_REPLAY_REJECTED

Include safe fields such as:
- tenant
- station
- device
- pump
- transaction
- correlation ID
- reason
- operation
- latency where useful

Never log secrets or sensitive credentials.

---

# 27. SECURITY REQUIREMENTS

Review and test:
- tenant leakage
- station leakage
- IDOR
- permission bypass
- device impersonation
- replay
- duplicate external events
- unsigned/untrusted callbacks
- unsafe credential storage
- race conditions
- mass assignment
- direct DB assumptions
- stale grants
- unauthorized settings overrides
- unauthorized price changes
- unauthorized shift reopen/correction
- unauthorized inventory adjustments

Fail closed where the existing Nebrax security model requires it.

---

# 28. TESTING REQUIREMENTS

Every cycle must include tests appropriate to its scope.

Required categories:
- Unit
- Feature/API
- RBAC
- Tenant isolation
- Station isolation
- Validation
- Audit
- Accounting integration where relevant
- PostgreSQL
- Frontend lint/type/build
- Mobile/responsive behavior review
- Concurrency where relevant
- Idempotency where relevant

Critical concurrency/idempotency cases:
- shift close
- fuel sale finalization
- fuel delivery receiving
- stock adjustment
- duplicate forecourt event
- duplicate payment callback
- offline replay
- duplicate RFID event

Do not consider SQLite-only success sufficient for database-sensitive behavior.

---

# 29. MIGRATION RULES

Migrations must be:
- additive where possible
- PostgreSQL-safe
- rollback-aware where feasible
- indexed for real query patterns
- tenant-safe
- foreign-key consistent with existing architecture

Do not silently use wrong types for UUID/reference fields.

Do not create mutable historical data where immutability/audit is required.

---

# 30. PERFORMANCE / SCALE

Design for:
- multiple stations per tenant
- many pumps/devices
- high transaction volume
- continuous device events
- operational dashboards
- reporting

Avoid:
- N+1 query patterns
- unbounded event scans
- loading entire device history into operational screens
- synchronous vendor calls in latency-sensitive flows when asynchronous/event-driven design is safer

Use indexes and pagination deliberately.

---

# 31. DOCUMENTATION DURING EXECUTION

After each cycle update `FUEL_STATIONS_MASTER_PLAN.md` with:
- Cycle status
- PR number
- merge SHA
- completed scope
- deferred items
- architectural decisions
- newly identified constraints

Do not rewrite the source-of-truth document into a progress diary; preserve the master scope and add structured implementation status.

Also update any repository architecture/runbook docs that genuinely need changes.

---

# 32. FINAL COMMERCIAL / PRODUCT BOUNDARIES

Do not:
- enable production entitlements for real tenants unless explicitly instructed
- change Render/environment variables unless explicitly instructed
- deploy `enforce_all`
- create production hardware credentials
- assume a specific forecourt/ATG/RFID vendor without evidence
- perform irreversible production data migration without explicit approval

The software may be built and tested fully with fake/simulated adapters before physical vendor integration.

---

# 33. FINAL READINESS AUDIT

After Cycle 9, perform a dedicated read/write audit and fix confirmed defects before declaring readiness.

Audit:

## Architecture
- accidental duplicate domains
- bypassed service layers
- vendor coupling
- settings hard-coding
- presentation/security mixing

## Tenancy
- tenant leakage
- station leakage
- cross-owner relations

## Security
- RBAC bypass
- IDOR
- replay
- device auth
- credential handling

## Financial
- double posting
- missing posting
- COGS mismatch
- stock mismatch
- shift cash mismatch
- incorrect invoice linkage

## Inventory
- ATG/book conflation
- duplicate movement
- incorrect reconciliation
- unsafe adjustment

## Devices
- duplicate events
- offline replay
- ordering
- failed sync visibility

## UX
- RTL
- mobile
- loading
- empty
- error
- offline
- permission states
- data density

## Database
- PostgreSQL
- indexes
- transactions
- locks
- races
- UUID/reference correctness

Fix only confirmed issues. Do not introduce speculative rewrites at the end.

---

# 34. DEFINITION OF DONE

Fuel Stations Management is not “done” because pages exist.

It is done only when the implemented scope supports a coherent real-world flow such as:

Station configured  
→ tanks/pumps/nozzles configured  
→ shift opened  
→ fuel received  
→ inventory updated  
→ vehicle/customer authorized  
→ fuel dispensed  
→ payment/customer charge recorded  
→ invoice/ZATCA produced where required  
→ inventory/COGS/accounting reconciled  
→ shift closed and approved  
→ cash/stock variance handled  
→ device/offline events remain recoverable  
→ management reports reconcile to source transactions  
→ every step is tenant-safe, permission-safe, audited, and tested.

---

# 35. MASTER REPORT FORMAT

Only after completing all cycles, produce one final report containing:

1. Current final `main` SHA
2. Cycle-by-cycle PR numbers and merge SHAs
3. Backend components created/changed
4. Frontend/workspace/screens created/changed
5. Settings implemented
6. Permissions implemented
7. Accounting/inventory integration summary
8. AVI/RFID architecture/status
9. Forecourt/ATG/device architecture/status
10. Offline/store-and-forward status
11. Maintenance/safety status
12. Reports/dashboard status
13. Full test results
14. PostgreSQL results
15. Frontend build/type/lint results
16. Known deferred vendor-specific integrations
17. Remaining production rollout steps
18. Confirmed unresolved risks, if any

Use one of these final verdicts only:

- `READY FOR CONTROLLED FUEL-STATION PILOT`
- `IMPLEMENTATION COMPLETE — BLOCKED ON SPECIFIC EXTERNAL INTEGRATION`
- `NOT READY — BLOCKING DEFECTS REMAIN`

Do not claim production readiness if hardware/vendor integrations required for the target pilot are still unknown or untested.

---

# 36. EXECUTE

Begin with the Preflight.

Do not re-ask for approval between already-defined cycles.

Protect existing Nebrax functionality.

Build the Fuel Stations platform as a native, coherent part of Nebrax — not as an isolated prototype.
