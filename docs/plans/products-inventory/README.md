# أَوْج / AWJ — Products & Inventory Implementation Program

**Status:** PLANNING COMPLETE — pending final branch/base reconciliation and owner review; no implementation authorized  
**Audit source:** `docs/audits/AWJ_PRODUCTS_INVENTORY_AUDIT_2026-09-05.md`  
**Data policy:** `docs/audits/AWJ_PRE_PRODUCTION_DATA_POLICY.md`  
**Implementation agent:** **Claude Code**

هذه الحزمة تحوّل التدقيق المغلق إلى برنامج تنفيذ مضبوط قبل بدء أي PR برمجي. التدقيق هو مصدر الحقائق المؤكدة؛ هذه الحزمة هي مصدر ترتيب التنفيذ والعقود والاعتماديات ومعايير القبول.

## قواعد حاكمة

- لا إعادة بناء Inventory Core/V2؛ نكمّل ونقوّي الموجود.
- سلامة المحاسبة، Inventory GL ↔ Subledger، Tenant Isolation، Same-tenant branch/warehouse authorization، base-UOM truth، concurrency/idempotency أولاً.
- Moving Average Cost يبقى global per Product ما لم يعتمد تصميم آخر صراحةً.
- Product Catalog Import لا ينشئ stock state أو GL.
- البيانات الحالية تجريبية وقابلة للتنظيف؛ لا نصمم تعقيد توافق لحمايتها.
- لا Merge/Deploy/Production Release دون موافقة صفوان الصريحة.
- كل PR صغير ومحدد؛ لا refactor جانبي ولا توسيع scope.
- أي قرار لم يحسمه التدقيق يبقى `NEEDS DECISION` ولا يختاره المنفذ من نفسه.
- التنفيذ البرمجي لهذا البرنامج يُسلّم إلى Claude Code؛ Cursor غير مستخدم في workflow الحالي.
- ChatGPT مسؤول عن التخطيط، ضبط Scope، مراجعة Implementation Reports، وتحديد الخطوة التالية.
- لا يُستخدم Work/Codex لإعادة فحص عمل Claude Code تلقائيًا؛ فقط عند وجود سبب تقني حقيقي.

## Phase 1 — Hardening gates

1. `PR-SEC-INV-1` — Same-tenant Stocktake/Stock Permit branch/warehouse authorization.
2. `PR-INV-1` — Central sensitive cost authorization/redaction.
3. `PR-PRICE-1` — Minimum sale price after all economically applicable discounts.
4. `PR-INV-2` — Purchase Return UOM/base quantity + valuation/GL reconciliation.
5. `PR-INV-3` — Stock Permit UOM/base quantity.
6. `PR-INV-4` — Stocktake concurrent/stale-snapshot reconciliation.
7. `PR-UOM-1` — In-use UOM mutation safety + Product.unit invariant + live-reference integrity + barcode namespace.
8. `PR-PROD-LIFE-1` — Product reference registry + inventory-identity guard.

Detailed contracts: `phase-1-hardening/`  
Claude Code handoffs: `prompts/PHASE1_IMPLEMENTATION_PROMPTS.md`

## Phase 2 — Completion

Detailed plans are in `phase-2-completion/`:
- Multiple UOM & Barcode Completion
- Durable Imports
- Warehouse Inventory Workspace
- Serial / Lot / Expiry
- Reservations & Availability
- Stock Requests / Approval / Fulfillment
- Low Stock / Replenishment
- Movement Source Drilldown
- dependency/release gates

Phase-2 files are program contracts, not executable implementation authorization. Each feature receives current-main PR decomposition and a final Claude Code prompt only after prerequisite hardening reports are reviewed.

## Phase 3 — Later

`phase-3-later/LATER-ROADMAP.md` records Media portability, quantity-tier pricing, intelligent replenishment, Bundles and deferred Manufacturing/BOM boundaries.

## Governance artifacts

- `DEPENDENCY_MAP.md` — hardening and cross-phase dependencies.
- `ACCEPTANCE_MATRIX.md` — per-PR proof obligations.
- `DECISION_REGISTER.md` — owner-level decisions that executors cannot invent.
- `PROGRAM-REVIEW-CHECKLIST.md` — pre-merge/pre-implementation completeness review.
- `IMPLEMENTATION-REPORT-TEMPLATE.md` — mandatory Claude Code report structure.

## تنفيذ Claude Code

كل Phase-1 PR contract هو العقد الهندسي، والـhandoff لا يجوز أن يغيّره. يجب على Claude Code في نهاية كل مهمة إنتاج Implementation Report MD كامل. ChatGPT يراجع التقرير أولًا قبل قرار PR التالي أو الدمج. لا Merge ولا Deploy تلقائيًا.

## بوابة الانتقال

لا يبدأ التنفيذ لمجرد اكتمال التخطيط. قبل أول PR برمجي يجب: (1) reconcile فرع الوثائق مع `main` الحالي، (2) تشغيل `PROGRAM-REVIEW-CHECKLIST.md` على الحزمة، (3) مراجعة/اعتماد صفوان، (4) دمج الوثائق فقط بموافقته، ثم (5) توليد handoff لـPR-SEC-INV-1 من Base SHA الحالي.