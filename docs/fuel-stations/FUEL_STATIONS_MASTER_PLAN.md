# Nebrax ERP — Fuel Stations Management Master Plan

> **Status:** Master Scope / Source of Truth  
> **Purpose:** Preserve the complete functional, technical, operational, integration, UI/UX, settings, security, accounting, and rollout plan for Fuel Stations Management in Nebrax ERP.  
> **Rule:** Future implementation by Manus, Claude Code, Codex, or any other agent must treat this document as the primary reference and must not silently omit scope.

---

## 1. Product Vision

Fuel Stations Management in Nebrax is not a lightweight station POS module.

It is a complete **Fuel Retail & Fleet Management Platform** inside Nebrax ERP that supports:

- Single fuel stations
- Multi-station operators
- Corporate fleet fueling
- Fuel credit customers
- Fuel cards
- RFID / AVI smart fueling
- Tanks and fuel inventory
- Pumps and nozzles
- Forecourt controller integrations
- ATG tank gauge integrations
- Shift and cash management
- Fuel receiving and supply
- Maintenance and safety
- Accounting and ZATCA
- Management reporting
- Device integration and offline operation

The product must be designed from day one so that later hardware integrations do not require rewriting the operational core.

---

## 2. Core Product Principle

The system must separate:

1. Business operation
2. Commercial entitlement
3. Tenant application state
4. Permissions / RBAC
5. Device integration
6. Accounting
7. Presentation / workspace mode

No navigation state, UI visibility, or device connection can become a security boundary.

---

## 3. Workspace Model

Fuel Stations Management is intended to be a dedicated workspace inside Nebrax while still integrating with the main Nebrax shell.

Main areas:

- Overview
- Operations
- Shifts
- Sales
- Pumps
- Tanks
- Inventory
- Supplies
- Customers
- Fleets
- Vehicles
- Drivers
- Fuel Cards
- RFID / AVI
- Maintenance
- Safety
- Reports
- Devices
- Integrations
- Settings

---

## 4. Main Functional Domains

### 4.1 Station Operations
- Stations
- Operating hours
- Managers
- Branch mapping
- Operational status
- Station hierarchy
- Station-scoped policies
- Daily operating day

### 4.2 Fuel Master Data
- Fuel products
- Units
- Density
- Tax category
- Inventory mapping
- Accounting mapping
- Pricing rules

### 4.3 Tanks
- Tank registry
- Capacity
- Safe capacity
- Minimum stock
- Dead stock
- Fuel product
- Opening stock
- Physical readings
- Book stock
- ATG stock
- Calibration tables
- Tank alarms
- Water level
- Temperature
- Reconciliation

### 4.4 Pumps and Nozzles
- Pumps
- Nozzles
- Pump-to-tank mapping
- Nozzle-to-product mapping
- Meter readings
- Opening / closing meters
- Pump status
- Downtime
- Calibration
- Controller mapping

### 4.5 Fuel Inventory
- Opening
- Delivery
- Sale
- Transfer
- Adjustment
- Loss
- Gain
- Evaporation
- Stocktake
- Reconciliation
- Costing
- Physical vs book stock
- ATG vs book stock

### 4.6 Fuel Supply and Receiving
- Purchase orders
- Supplier
- Tanker
- Driver
- Delivery note
- Dispatched liters
- Received liters
- Temperature
- Density
- Seal numbers
- Compartment details
- Before / after tank reading
- Before / after ATG reading
- Transit variance
- Supplier invoice matching
- Receiving approval

### 4.7 Shifts
- Shift opening
- Staff assignment
- Opening cash
- Opening meter readings
- Opening tank readings
- Active terminals
- Sales during shift
- Expenses
- Cash movements
- Payment totals
- Closing meter readings
- Closing tank readings
- Cash count
- Shortage / overage
- Supervisor approval
- Shift locking
- Correction workflow after approval

### 4.8 Fuel Sales
Fuel transaction should be independent from payment transaction.

Fuel transaction fields include:
- Tenant
- Station
- Shift
- Pump
- Nozzle
- Fuel product
- Start meter
- End meter
- Liters
- Unit price
- Total
- Vehicle
- Driver
- Authorization
- Customer
- Invoice
- External device references

### 4.9 Payments
Supported methods:
- Cash
- Bank card
- Corporate credit account
- Fuel card
- RFID / AVI
- QR
- Voucher
- Employee account
- External fleet provider
- External payment provider

Payment state must remain separate from fuel sale state.

---

## 5. Corporate Customers, Fleets and Vehicles

### Corporate Customer
- Contract
- Credit limit
- Payment terms
- Allowed stations
- Allowed fuels
- Contract pricing
- Monthly billing
- Customer-specific policies

### Vehicles
- Plate number
- VIN
- Fleet number
- Customer
- Fuel type
- Tank capacity
- Odometer
- Driver
- Cost center
- Fuel history

### Drivers
- Driver identity
- PIN
- Smart card
- Phone
- Status
- Assigned vehicles
- Allowed stations

---

## 6. Fuel Cards

Fuel cards are not treated as only a payment method.

They must support:
- Customer
- Vehicle
- Driver
- Cost center
- Fuel type restrictions
- Station restrictions
- Daily limits
- Weekly limits
- Monthly limits
- Liter limits
- Value limits
- Transaction count limits
- Allowed time windows
- Suspend
- Cancel
- Replace
- Usage history

---

## 7. RFID / AVI Smart Fueling

RFID / AVI is a strategic part of the platform.

### Supported identification approaches
- Vehicle RFID tag
- Driver smart card
- Vehicle tag + driver card
- QR
- PIN
- Odometer confirmation

### Authorization flow
Vehicle detected  
→ identity resolved  
→ customer contract checked  
→ vehicle status checked  
→ driver checked if required  
→ allowed fuel checked  
→ allowed station checked  
→ usage limits checked  
→ time restrictions checked  
→ fraud controls checked  
→ pump authorized  
→ fueling occurs  
→ transaction finalized  
→ inventory updated  
→ customer charged  
→ accounting posted

### Policies
- Fuel type
- Liters per day
- Value per day
- Weekly limit
- Monthly limit
- Transaction count
- Minimum time between fueling
- Tank capacity sanity check
- Odometer requirement
- Driver requirement
- Station allowlist
- Time allowlist
- Vehicle-specific restrictions

### Anti-fraud
- Duplicate tag detection
- Blacklisted tag
- Wrong fuel attempt
- Refill too soon
- Quantity exceeds vehicle capacity
- Suspicious odometer
- Suspicious station usage
- Repeated denied authorization attempts

---

## 8. Forecourt / Pump Integration Architecture

Future forecourt integration is a mandatory architectural requirement.

The internal business domain must not depend directly on one manufacturer.

Architecture:

Device  
→ Driver  
→ Adapter  
→ Normalized Event  
→ Fuel Station Domain

Possible normalized events:
- FuelDispenseStarted
- FuelDispenseCompleted
- PumpAuthorized
- PumpAuthorizationDenied
- PumpOffline
- PumpOnline
- NozzleLifted
- MeterReadingUpdated
- PriceChanged

The system must allow adding new vendors later without changing business logic.

---

## 9. ATG Integration Architecture

ATG readings must never directly overwrite accounting stock.

Maintain separately:

- Book stock
- Physical stock
- ATG stock

ATG may provide:
- Product level
- Volume
- Temperature
- Water level
- Ullage
- Alarm status
- Sensor status

ATG is an evidence/input source for reconciliation.

---

## 10. Device Registry

Every external station device must be registered.

Fields may include:
- Tenant
- Station
- Device type
- Manufacturer
- Model
- Serial
- Firmware
- Protocol
- IP / port
- External identifier
- Driver
- Credential reference
- Last seen
- Health status
- Sync status
- Installed date
- Retired date

Device types:
- Forecourt controller
- ATG
- Pump controller
- RFID reader
- Card reader
- Payment terminal
- QR terminal
- Station gateway
- Other supported station devices

---

## 11. Offline / Store-and-Forward

This is mandatory.

A station must not stop operating because internet connectivity is lost.

Future Station Edge Gateway / Local Agent must be able to store:

- Fuel transactions
- Pump events
- ATG readings
- RFID authorizations
- Payment references
- Device events

Every offline event should support:
- event_id
- device_id
- sequence
- timestamp
- checksum
- correlation_id
- sync status

Requirements:
- Idempotency
- Replay protection
- Duplicate prevention
- Ordered reconciliation where required
- Conflict handling
- Retry strategy
- Dead-letter handling
- Recovery after reconnect

---

## 12. Fuel Pricing

Support:
- Product price
- Station-specific price
- Effective date/time
- Customer contract price
- Fleet price
- Promotional price if later required
- Price history
- Price change approval
- Future forecourt price push

Price change must be fully audited.

---

## 13. Fuel Inventory Reconciliation

Operational equation:

Opening stock  
+ Deliveries  
- Sales  
± Transfers  
± Adjustments  
= Expected closing stock

Compare against:
- Physical reading
- ATG reading

Calculate:
- Quantity variance
- Percentage variance
- Financial variance

Settings define:
- Allowed tolerance
- Approval threshold
- Adjustment permissions
- Escalation
- Accounting treatment

---

## 14. Cash and Treasury

Support:
- Shift cashbox
- Opening float
- Cash sales
- Cash count
- Shortage
- Overage
- Bank deposit
- Cash transfer
- Settlement
- Approval

Cash differences must not silently disappear.

---

## 15. Expenses

Station expenses:
- Maintenance
- Electricity
- Labor
- Services
- Supplies
- Operating expenses
- Emergency expenses

Support:
- Category
- Shift
- Station
- Employee
- Approval
- Attachment
- Limit
- Accounting mapping

---

## 16. Maintenance

Assets:
- Pumps
- Nozzles
- Tanks
- ATG
- Controllers
- Generators
- Compressors
- Payment terminals
- RFID readers
- Other station equipment

Support:
- Preventive maintenance
- Corrective maintenance
- Work orders
- Maintenance schedules
- Spare parts
- Vendor
- Downtime
- Cost
- Recurring fault history
- SLA if needed later

---

## 17. Safety and Compliance

Support:
- Safety inspections
- Checklists
- Fire extinguishers
- Emergency systems
- Leak reporting
- Incidents
- Corrective actions
- Permits
- Certificates
- Expiry dates
- Escalation
- Attachments
- Audit trail

---

## 18. Accounting Integration

Reuse Nebrax accounting engine.

Examples:

### Fuel sale
Dr Cash / Bank / Customer  
Cr Fuel Revenue

Then:
Dr COGS  
Cr Fuel Inventory

### Fuel supply
Dr Fuel Inventory  
Cr Supplier / GRNI according to final Nebrax accounting policy

### Inventory variance
Post to configured Fuel Loss / Gain account when approved.

### Shift cash shortage
Use configured cash shortage / overage account.

No duplicate accounting engine should be created inside Fuel Stations.

---

## 19. ZATCA and Invoicing

Reuse Nebrax Invoice Engine.

Support:
- Simplified tax invoices
- Tax invoices
- B2B monthly invoicing
- QR
- Tax data
- Existing Nebrax numbering and compliance rules

RFID/AVI/forecourt transactions ultimately flow into the same approved invoicing/accounting systems.

---

## 20. Dashboards

### Station Dashboard
KPIs:
- Sales today
- Liters today
- Gross margin
- Stock
- Tank days remaining
- Open shifts
- Cash variance
- Deliveries today
- Pump availability
- Active alerts

### Live Operations
Examples:
- Pump 1 — Fueling
- Pump 2 — Idle
- Pump 3 — Offline
- Tank 01 — 68%
- Tank 02 — Low stock

### Multi-Station Command Center
Compare:
- Sales
- Liters
- Inventory
- Margin
- Alerts
- Device downtime
- Cash variance
- Stock variance
- Open shifts

---

## 21. Reports

### Sales
- By station
- By fuel
- By pump
- By nozzle
- By shift
- By employee
- By payment method
- By customer
- By vehicle

### Inventory
- Opening
- Received
- Sold
- Transferred
- Closing
- Variance
- Loss
- Gain
- Stocktake
- Tank reconciliation

### Profitability
- Revenue
- COGS
- Margin per liter
- Margin by station
- Margin by customer
- Margin by fuel

### Fleet
- Customer consumption
- Vehicle consumption
- Driver consumption
- Limits
- Denials
- Credit exposure

### RFID / AVI
- Authorizations
- Denials
- Reasons
- Suspicious usage
- Card/tag status

### Devices
- Uptime
- Downtime
- Faults
- Sync errors
- Last seen

### Maintenance
- Maintenance cost
- Downtime
- Recurring faults
- Planned vs reactive work

### Safety
- Inspections
- Failed checks
- Incidents
- Open corrective actions
- Expiring permits

---

## 22. Settings Architecture

Settings are a first-class part of the product, not an afterthought.

Rule:

> Any operational, organizational, configurable, station-specific, device-specific, approval-related, or policy-related behavior must be configurable when appropriate and must not be silently hard-coded.

Hierarchy:

System Default  
→ Tenant  
→ Station  
→ Device / Terminal Override

Support inheritance and controlled overrides.

### Settings Categories

#### General
- Operating day
- Timezone
- Units
- Numbering
- Station policies

#### Fuel
- Products
- Rounding
- Pricing
- Density settings

#### Tanks
- Minimum stock
- Safe capacity
- Variance tolerance
- Reconciliation rules

#### Pumps / Forecourt
- Authorization mode
- Pump timeout
- Controller mappings
- Offline behavior

#### ATG
- Polling
- Reading intervals
- Alarm rules
- Reconciliation behavior

#### Shifts
- Opening requirements
- Closing requirements
- Mandatory readings
- Approval
- Auto-close policy if ever allowed
- Variance limits

#### Sales
- Discount policy
- Void policy
- Refund policy
- Credit sales policy

#### Payments
- Payment methods
- Terminal mapping
- Settlement rules

#### Fleet
- Limits
- Allowed fuels
- Allowed stations
- Odometer requirements

#### RFID / AVI
- Tag policies
- Driver verification
- Offline authorization
- Security rules

#### Inventory
- Costing
- Adjustments
- Loss / gain policy
- Stocktake

#### Supply
- Delivery tolerance
- Required documents
- Receiving approval

#### Customers
- Credit limits
- Blocking rules
- Contract pricing
- Consolidated billing

#### Cash
- Opening float
- Cash limits
- Deposit rules
- Shortage approval

#### Expenses
- Categories
- Limits
- Required attachments
- Approval

#### Maintenance
- Maintenance intervals
- Alerts
- Escalation

#### Safety
- Checklist schedules
- Permit expiry
- Incident escalation

#### Accounting
- GL mappings
- COGS
- Inventory
- Variances
- Cash differences
- Tax

#### Notifications
- Recipients
- Severity
- Escalation
- In-app / email / future channels

#### Integrations
- Provider configuration
- Device mapping
- Driver
- Credentials
- Health checks
- Retry
- Store-and-forward

#### Reports
- Operational cutoff
- Timezone
- Rounding
- Volume basis
- Temperature basis

---

## 23. Settings Audit

Critical configuration changes must record:

- before
- after
- changed_by
- changed_at
- tenant
- station
- device where applicable
- reason where required

High-risk settings:
- Fuel prices
- Inventory tolerance
- RFID policies
- Credit limits
- Payment configuration
- Forecourt configuration
- ATG configuration
- Accounting mappings

---

## 24. Roles and Permissions

Potential roles:
- Platform Admin
- Tenant Owner
- Operations Manager
- Area Manager
- Station Manager
- Shift Supervisor
- Cashier
- Pump Attendant
- Inventory Controller
- Accountant
- Maintenance Technician
- Safety Officer
- Fleet Customer Operator

Example permissions:
- fuel.shift.open
- fuel.shift.close
- fuel.shift.approve
- fuel.price.change
- fuel.delivery.receive
- fuel.delivery.approve
- fuel.inventory.adjust
- fuel.inventory.approve
- fuel.rfid.manage
- fuel.device.configure
- fuel.maintenance.manage
- fuel.safety.manage

Backend remains authoritative.

---

## 25. UI / UX

Apply Nebrax Design System.

Core rules:
- RTL-first
- Dense but clear operational UI
- IBM Plex Sans Arabic for UI
- IBM Plex Mono for financial / code / meter values
- Design tokens as source of truth
- No raw hex in components
- No gradients
- No heavy shadows
- No decorative colored icon boxes
- Tables as a primary ERP surface
- Mobile compatibility mandatory
- Financial values visually aligned
- Clear status semantics
- Loading / empty / error / offline states

### Workspace Sidebar

Overview

Operations:
- Shifts
- Sales
- Pumps
- Tanks

Fuel:
- Inventory
- Supplies
- Stocktake
- Reconciliation

Customers & Fleet:
- Customers
- Vehicles
- Drivers
- Fuel Cards
- RFID / AVI

Maintenance & Safety:
- Maintenance
- Assets
- Inspections
- Incidents

Reports:
- Operations
- Sales
- Inventory
- Profitability
- Fleet
- Devices

Settings:
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

---

## 26. Mobile UX

Mobile workflows are mandatory for station operations.

Support:
- Open shift
- Close shift
- Meter reading
- Tank reading
- Receive fuel delivery
- Upload delivery photo
- Quick expense
- Safety inspection
- Maintenance report
- Approve variance
- View low-stock alerts

Use contextual bottom actions where better than desktop navigation patterns.

---

## 27. Backend Architecture

Prefer clear application/domain boundaries.

Example:

Controller  
→ Application Service  
→ Domain Service  
→ Repository / Eloquent  
→ Events

Avoid large controllers manipulating models directly.

Critical services:
- Shift close
- Tank reconciliation
- Delivery receiving
- Fuel authorization
- RFID authorization
- Forecourt event processing
- ATG event processing
- Commercial / customer limits
- Inventory adjustment

---

## 28. Domain Events

Possible events:

- ShiftOpened
- ShiftClosed
- FuelDispenseStarted
- FuelDispenseCompleted
- FuelDeliveryReceived
- TankReadingRecorded
- TankVarianceDetected
- VehicleIdentified
- FuelAuthorizationApproved
- FuelAuthorizationDenied
- PumpWentOffline
- PumpCameOnline
- DeviceHeartbeatMissed
- PriceChanged
- StockAdjustmentApproved

---

## 29. API Architecture

Operational APIs:
`/api/fuel-stations/...`

External integration APIs should remain separated, for example:
- `/api/integrations/forecourt/...`
- `/api/integrations/atg/...`
- `/api/integrations/avi/...`

Device authentication must differ from ordinary user authentication.

---

## 30. Device Security

Every gateway/integration device must have an explicit identity.

Support:
- Device credentials
- Secret/certificate rotation
- Signed requests
- Replay protection
- Sequence validation
- Correlation IDs
- Revocation
- Scoped permissions
- Optional IP restrictions where appropriate

Never use one shared API token for all stations/devices.

---

## 31. Observability

Structured events should include:
- tenant
- station
- device
- pump
- transaction
- user where relevant
- correlation_id
- reason
- latency where useful

Examples:
- FUEL_SHIFT_OPENED
- FUEL_SHIFT_VARIANCE
- FUEL_TANK_VARIANCE
- FUEL_DEVICE_OFFLINE
- FUEL_AVI_DENIED
- FUEL_ATG_SYNC_ERROR
- FUEL_FORECOURT_SYNC_ERROR
- FUEL_PAYMENT_SETTLEMENT_ERROR

Do not log sensitive credentials.

---

## 32. Testing Strategy

### Unit
Business/domain rules.

### Feature
APIs and authorization.

### Integration
Accounting and cross-domain behavior.

### Concurrency
Especially:
- Shift close
- Fuel transaction finalization
- Inventory adjustment
- Duplicate device event
- Offline replay

### Device Simulation
Provide:
- FakeForecourtDriver
- FakeAtgDriver
- FakeRfidDriver

This allows full integration tests before physical hardware is available.

### Database
PostgreSQL path is mandatory.

---

## 33. Multi-Tenant and Multi-Station Requirements

Every record must respect tenant isolation.

Most operational records also require station scope.

Support:
- One tenant with many stations
- Centralized management
- Station-scoped permissions
- Cross-station comparative reports
- Transfers
- Shared tenant policies with station overrides

---

## 34. Commercial Entitlement

Fuel Stations should be a commercial add-on / application inside Nebrax.

Possible technical capabilities:
- fuel_stations.core
- fuel_stations.inventory
- fuel_stations.forecourt
- fuel_stations.fleet
- fuel_stations.avi
- fuel_stations.maintenance
- fuel_stations.integrations

ApplicationCatalog remains technical capability source of truth.

Commercial entitlement, tenant state, RBAC, backend enforcement, and presentation remain separate.

---


## 34A. Commercial Product Packaging & Application Behavior

Fuel Stations Management must be treated as an **optional commercial application / add-on** inside Nebrax. It is not automatically enabled for every tenant.

The required control flow is:

**Application Catalog → Commercial Entitlement → Tenant Application State → RBAC → Backend Enforcement → Workspace / UI**

Commercially, the default packaging model is:

- Product identity: `fuel-stations`
- Sell it primarily as **one commercial product/add-on**
- It may be:
  - purchased independently,
  - included in a commercial plan,
  - granted as a trial,
  - granted through an approved legacy/commercial exception,
  - cancelled,
  - revoked,
  - expired,
  - degraded to read-only according to the platform entitlement lifecycle where applicable.

Technical capabilities may include:

- `fuel_stations.core`
- `fuel_stations.inventory`
- `fuel_stations.forecourt`
- `fuel_stations.fleet`
- `fuel_stations.avi`
- `fuel_stations.maintenance`
- `fuel_stations.integrations`

These technical capabilities exist for authorization, packaging flexibility, dependency handling, and future product evolution. They must **not** automatically become separate paid add-ons. Do not fragment the initial commercial product unnecessarily.

The exact technical capability list may be refined after inspection of the repository, but the following rules are fixed:

1. `fuel-stations` is the primary commercial product identity.
2. Commercial packaging is separate from technical capabilities.
3. Commercial entitlement is separate from `TenantApplicationState`.
4. `TenantApplicationState` remains responsible for the tenant's operational enable/disable/suspend choice.
5. RBAC remains responsible for user permissions inside the application.
6. Backend enforcement remains authoritative.
7. Hiding the workspace or navigation is not a security boundary.
8. The application may appear under **Settings → Applications** as an available/included/add-on/trial application according to the existing Nebrax commercial experience.
9. When the tenant has no effective entitlement/access, the backend must reject protected Fuel Stations routes/actions even if a URL is entered directly.
10. When effectively entitled and operationally enabled, Fuel Stations may expose its dedicated workspace.
11. Trial, plan-included, add-on, cancellation, expiry, revocation, grace/read-only, and legacy behavior must reuse the platform entitlement lifecycle rather than create a Fuel-Stations-specific commercial state machine.
12. Do not use feature flags, navigation state, or workspace presentation mode as the commercial entitlement source of truth.

### UI behavior in Settings → Applications

The application card / commercial experience should be capable of showing, according to existing Nebrax entitlement conventions:

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

The UI may provide the appropriate CTA according to commercial state and user authority, but UI actions must call backend-authoritative services.

### Workspace behavior

Fuel Stations is intended to have a dedicated operational workspace because its station workflows, devices, shifts, tanks, pumps, and live operations justify a focused navigation shell.

However:

**Workspace presentation is not entitlement.**

A tenant can only reach Fuel Stations backend operations when the full access chain authorizes the operation.


## 35. Implementation Cycles

### Cycle 0 — Architecture & Domain Foundation
- Domain boundaries
- Capability design
- Tenant/station scoping
- Base models
- Settings foundation
- Event model
- Integration contracts

### Cycle 1 — Stations, Tanks, Pumps & Master Data
- Stations
- Fuel products
- Tanks
- Pumps
- Nozzles
- Station configuration

### Cycle 2 — Fuel Inventory & Tank Management
- Inventory ledger
- Physical/book/ATG separation
- Reconciliation
- Adjustments
- Stocktake
- Loss/gain

### Cycle 3 — Supply & Fuel Receiving
- Purchase flow
- Fuel delivery
- Tanker/compartment data
- Receiving
- Variance
- Approval

### Cycle 4 — Shift & Forecourt Operations
- Shift opening
- Meter readings
- Tank readings
- Shift transactions
- Shift closing
- Approval
- Locking/correction

### Cycle 5 — POS, Payments & Fuel Sales
- Fuel transaction
- Payment transaction
- POS flow
- Payment methods
- Refund/void rules
- Settlement

### Cycle 6 — Corporate Customers, Fleet & Fuel Cards
- Corporate contracts
- Vehicles
- Drivers
- Fuel cards
- Credit limits
- Pricing
- Fleet usage

### Cycle 7 — AVI / RFID Smart Fueling

**الحالة: مكتملة — 2026-08-23.** يطبق التنفيذ هوية وسوم محايدة عن المورد (مركبة/سائق وRFID/QR/PIN)، تخزين بصمة اعتماد فقط، قرار تفويض صريح append-only، سياقات عميل/عقد/بطاقة/مركبة/سائق مقفلة، idempotency، وعزل المستأجر/الفرع. يعيد محرك القرار استخدام فحوص Cycle 6 للعقد والقيود والبطاقة والائتمان، ثم لا يسمح بأثر رسمي إلا عبر `FuelSale → InvoiceService → PaymentService` القائم. لا ينشئ قرار التفويض نفسه فاتورة أو دفعة أو حركة مخزون أو قيداً.

**المنفذ:**
- RFID/AVI identity domain مع حالات تعليق/فقد/blacklist/استبدال وسجل تدقيق
- هوية المركبة والسائق (المفردة والثنائية) وربطها بالعقد والأسطول
- Authorization engine بأسباب رفض صريحة وإشارات إعادة تعبئة مبكرة وسعة خزان ونمط رفض متكرر
- سياسات مستأجر/محطة مدققة: التفعيل، السائق المطلوب، فاصل التزويد، سعة المركبة، نافذة/عتبة الرفض وTTL
- ربط قرار موافق واحد بمسودة بيع مطابقة وإعادة تحقق قبل الإنهاء
- RBAC مستقل (`fuel.avi.view/manage/authorize`) وقدرة `fuel_stations.avi` مبنية
- واجهة عربية RTL لإدارة الوسوم وقرارات التفويض، مع دعم مرجع تفويض في مسودة البيع

**المؤجل عمداً إلى Cycle 8:** تسجيل قارئ أو Device Registry، أسرار/هوية جهاز، adapters أو drivers لمورد، أمر فتح مضخة، callbacks وATG، وoffline/store-and-forward الفعلي. تبقى مفردات الأحداث `vehicle.identified` و`fuel.authorization.approved/denied` جاهزة للعقد المعياري من دون producer خارجي.

### Cycle 8 — Forecourt, ATG & Device Integration Platform
- Device registry
- Driver/adapters
- Forecourt normalized events
- ATG normalized readings
- Offline/store-and-forward contracts
- Fake drivers

### Cycle 9 — Maintenance, Safety, Accounting, Reports & Readiness
- Maintenance
- Safety
- Accounting integration
- ZATCA
- Dashboards
- Reports
- Permissions hardening
- Observability
- Final regressions
- Production readiness

---

## 36. Rollout Strategy

### Alpha
One internal/test station.

### Pilot
1–3 stations.

### Controlled Rollout
Expand gradually.

### Production
Only after comparing against prior/parallel records:
- Sales totals
- Liters
- Tank stock
- Shift closure
- Cash
- Accounting
- Customer balances

No big-bang deployment for critical station operations.

---

## 37. Vendor / Agent Handoff Readiness

The project must remain transferable between Manus, Claude Code, Codex, or another capable agent.

Source of truth:
- GitHub main
- This Master Plan
- Architecture contracts
- Design System
- Tests
- PR history

At every major handoff provide:
- Current main SHA
- Completed cycles
- Open gaps
- What must not be rebuilt
- Required test commands
- Branch/PR rules
- Production boundaries

The implementation tool can change; the architecture must not depend on the tool.

---

## 38. Non-Negotiable Rules

1. Do not hard-code operational policies that belong in settings.
2. Do not make UI/navigation a security boundary.
3. Do not let ATG overwrite accounting stock directly.
4. Do not couple core logic to one pump/ATG/RFID vendor.
5. Do not assume permanent internet connectivity.
6. Do not duplicate Nebrax accounting or invoicing engines.
7. Do not mix tenant state with commercial entitlement.
8. Do not bypass tenant/station isolation.
9. Do not silently mutate approved/closed shifts.
10. Do not accept duplicate device events.
11. Do not use one shared device credential across stations.
12. Do not delay integration architecture until hardware phase.
13. Every critical configuration change must be audited.
14. Mobile station workflows are mandatory.
15. PostgreSQL regression testing is mandatory.

---

## 39. Final Target

The final system should operate as a complete:

**Fuel Retail + Station Operations + Fleet Fueling + Smart AVI/RFID + Forecourt/ATG Integration Platform**

inside Nebrax ERP, ready for:
- Manual station operation
- Automated pump operation
- Smart vehicle fueling
- Corporate fleet contracts
- Multi-station operations
- Future external payment/fuel-card providers
- Future manufacturer-specific forecourt/ATG integrations

---

## 40. Document Maintenance

This is a living master document.

Any future confirmed requirement related to Fuel Stations Management should be added here before or during implementation so that no requirement remains trapped only in chat history.

When implementation begins:
- Mark each Cycle with status
- Add PR numbers
- Add merge SHAs
- Record architectural decisions
- Record deferred integrations
- Record confirmed vendor/device protocols
