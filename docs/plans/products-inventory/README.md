# أَوْج / AWJ — Products & Inventory Implementation Program

**Status:** PLANNING — no implementation authorized  
**Audit source:** `docs/audits/AWJ_PRODUCTS_INVENTORY_AUDIT_2026-09-05.md`  
**Data policy:** `docs/audits/AWJ_PRE_PRODUCTION_DATA_POLICY.md`

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

## المراحل

### Phase 1 — Hardening gates

1. `PR-SEC-INV-1` — Same-tenant Stocktake/Stock Permit branch/warehouse authorization.
2. `PR-INV-1` — Central sensitive cost authorization/redaction.
3. `PR-PRICE-1` — Minimum sale price after all economically applicable discounts.
4. `PR-INV-2` — Purchase Return UOM/base quantity + valuation/GL reconciliation.
5. `PR-INV-3` — Stock Permit UOM/base quantity.
6. `PR-INV-4` — Stocktake concurrent/stale-snapshot reconciliation.
7. `PR-UOM-1` — In-use UOM mutation safety + Product.unit invariant + live-reference integrity + barcode namespace.
8. `PR-PROD-LIFE-1` — Product reference registry + inventory-identity guard.

### Phase 2 — Completion

Multiple UOM/Barcode completion → durable imports → warehouse Inventory Workspace → Serial/Lot/Expiry → Reservations/Availability → Stock Requests/Approval/Fulfillment → Low Stock/Replenishment → Movement source drilldown.

### Phase 3 — Later

Media migration package, quantity-tier pricing, intelligent replenishment, bundles. Manufacturing/BOM remains deferred.

## تنفيذ الوكلاء

كل ملف PR في `phase-1-hardening/` هو العقد الهندسي. ملفه المقابل في `prompts/` هو handoff تنفيذي، ولا يجوز أن يغيّر العقد. يجب على Cursor/Claude Code في النهاية إنتاج Implementation Report بصيغة MD يتضمن: ما تم، الملفات المتغيرة، الاختبارات ونتائجها، Build/CI، المخاطر والمتبقي، Branch/PR/Base SHA/Head SHA إن توفرت، والخطوة التالية.

## بوابة الانتقال

لا يبدأ Phase 2 لمجرد اكتمال بعض PRs. يجب أن تكون hardening gates المرتبطة بالميزة التالية مغلقة ومختبرة أولاً، وفق `DEPENDENCY_MAP.md` و`ACCEPTANCE_MATRIX.md`.