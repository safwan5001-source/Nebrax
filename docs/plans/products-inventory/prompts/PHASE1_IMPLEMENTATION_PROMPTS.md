# Phase 1 — Implementation Handoff Prompts

هذه البرومبتات ليست بديلًا عن ملفات العقود في `phase-1-hardening/`. على المنفذ قراءة العقد المحدد + README + Dependency Map + Acceptance Matrix + التدقيق المغلق، ثم فحص الملفات اللازمة فقط من `main` الحالي. لا يبدأ من الصفر ولا يوسع Scope.

## قالب التقرير الإلزامي لكل مهمة

أنشئ/حدّث تقرير تنفيذ MD يتضمن: Summary؛ ما تم؛ الملفات المتغيرة؛ migrations/API/schema changes؛ الاختبارات والأوامر والنتائج؛ Build/Lint/Typecheck؛ CI؛ accounting/security/tenant/UOM evidence ذات الصلة؛ المخاطر والمتبقي؛ deviations عن الخطة؛ Branch؛ PR؛ Base SHA؛ Head SHA؛ الخطوة التالية. لا Merge ولا Deploy.

---

## PR-SEC-INV-1

نفّذ فقط العقد `phase-1-hardening/PR-SEC-INV-1.md`. ابدأ بفحص StocktakeController وStockPermitController وApiController/Branch/Warehouse access helpers والاختبارات ذات الصلة. أنشئ record-level authorization موحدًا قدر الإمكان دون تحويل أعمى إلى BranchScoped ودون تغيير المحاسبة/UOM. أثبت same-tenant denied UUID paths لكل read/mutation/post، transfer source+target، وعدم حدوث stock/GL side effects عند الرفض. شغّل targeted tests ثم inventory/security wider tests المناسبة. توقف عند أي تعارض معماري بدل توسيع المهمة. سلّم تقرير MD الإلزامي. لا Merge/Deploy.

## PR-INV-1

نفّذ فقط `phase-1-hardening/PR-INV-1-cost-authorization.md`. احصر الأسطح المؤكدة من التدقيق ثم ابنِ تصنيف/سياسة backend مركزية لـsensitive cost. طبّقها على resources/activity/export/inventory movements/filter-sort/write/import apply مع authorized/unauthorized tests. لا تغيّر costing أو sale-price semantics أو roles خارج الحاجة. أعد التحقق من الصلاحية عند import apply. سلّم تقرير MD. لا Merge/Deploy.

## PR-PRICE-1

نفّذ فقط `phase-1-hardening/PR-PRICE-1.md`. حدّد authoritative pricing/invoice path الحالي وموضع line/header discount allocation. انقل/أضف minimum-sale-price guard إلى final effective economics مع rounding deterministic والحفاظ على authorized override وPOS/API consistency. لا تبنِ pricing engine جديدًا ولا تربط السعر بـUOM factor. اختبر matrices المطلوبة. سلّم تقرير MD. لا Merge/Deploy.

## PR-INV-2

نفّذ فقط `phase-1-hardening/PR-INV-2-purchase-returns.md`. افحص Purchase Return domain + original PurchaseLine snapshots + InventoryService + Ledger posting. صحّح base quantity التاريخية وvaluation بحيث 1140 يساوي subledger delta مع فصل supplier commercial credit عن carrying value. حافظ على negative-stock and double-post/atomicity. لا تغيّر costing architecture. سلّم تقرير MD مع reconciliation evidence. لا Merge/Deploy.

## PR-INV-3

نفّذ فقط `phase-1-hardening/PR-INV-3-stock-permit-uom.md`. افحص API/UI contract أولًا لتحديد معنى receipt `unit_cost` الحالي ولا تخمّن. أضف immutable UOM snapshot/base quantity semantics بطريقة متوافقة مع base-unit clients. issue/transfer availability and movements must use base quantity; preserve same/cross-branch GL behavior. اختبر base/alt units لكل permit type. سلّم تقرير MD. لا Merge/Deploy.

## PR-INV-4

نفّذ فقط `phase-1-hardening/PR-INV-4-stocktake.md`. قبل الكود اختر ودوّن في التقرير policy آمنة ضد stale snapshot بعد فحص حركة المخزون الحالية؛ فضّل detect/reconcile على freeze واسع إن كان يحقق correctness بأقل تعطيل. لا تسمح stale delta silent posting. أثبت concurrent sale/receipt/transfer scenarios و1140/subledger reconciliation والrollback. لا تضف multi-UOM/serial/reservations. سلّم تقرير MD. لا Merge/Deploy.

## PR-UOM-1

نفّذ فقط `phase-1-hardening/PR-UOM-1.md`. افحص UnitTemplate mutation, Product.unit, ProductBarcode, PriceListItem, held POS carts, Product import and DB constraints. أنشئ semantic mutation protection وtenant-wide atomic barcode namespace دون money derivation. لا تحسم soft-delete barcode reuse دون قرار صريح؛ إذا كان التصميم يتطلب القرار، توقف ورفعه كـBLOCKED/NEEDS DECISION. نسّق registry needs مع PR-PROD-LIFE-1 ولا تنشئ نظامين متعارضين. سلّم تقرير MD. لا Merge/Deploy.

## PR-PROD-LIFE-1

نفّذ فقط `phase-1-hardening/PR-PROD-LIFE-1.md`. استبدل census اليدوي الهش بعقد تصنيف مركزي مع architecture/regression guard للمراجع الجديدة. ضمّن InventoryOpeningLine وDeliveryNoteLine والتصنيف المعتمد، واحمِ type/track_inventory من InventoryOpeningLine footprint. ProductActivity ليس blocker ساذجًا؛ owned children ليست historical blockers. افحص global/branch scopes حتى لا تخفي references. عالج TOCTOU بالقدر المطلوب ضمن Scope. سلّم تقرير MD. لا Merge/Deploy.

---

## قاعدة اختيار الوكيل

هذه المهام مصممة لتكون scoped PRs ويمكن تنفيذها في Cursor عندما تكون مستقلة وواضحة. إذا كشف التنفيذ أن PR يحتاج استكشافًا واسعًا أو refactor متعدد الأنظمة، توقف قبل التوسع وارفع ذلك؛ عندها يمكن نقل المهمة إلى Claude Code بقرار منفصل. لا تستخدم Work/Codex تلقائيًا لإعادة تنفيذ/فحص ما يستطيع الوكيل إنجازه واختباره.