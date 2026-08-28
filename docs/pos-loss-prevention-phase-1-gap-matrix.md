# POS Loss Prevention — Phase 1: Gap Matrix

> أُنجز هذا التدقيق على `main` عند الالتزام `ff3ba041` قبل إنشاء فرع التنفيذ. المرجع الوظيفي هو GitHub Issue #525، والتعليمات التفصيلية المرفقة مع المهمة.

| Requirement | Existing | Gap | Reuse/Extend Decision |
|---|---|---|---|
| سجل حياة السلة و`cart_id` خادمي | السلال النشطة محلية في `use-pos-active-carts`؛ لا هوية خادمية أو timeline للسلة. | لا يمكن ربط التعديلات وإلغاء السلة بالجلسة على نحو موثوق. | توسيع `PosSessionEvent` بإسناد `cart_id` و`correlation_id`، وإضافة نقطة إنشاء سلة خادمية تسجل `cart_created`؛ لا إنشاء محرك بيع أو مصدر مالي جديد. |
| أدلة append-only | `PosSessionEvent` يمنع `update/delete` بالفعل، ويحتوي أحداث الدرج والحركات والمرتجع والاستبدال وفروقات الإغلاق. | الأحداث لا تحمل سلة أو تصنيف/سبب/مراجع موحدة، ولا تلتقط تغييرات السلة الحساسة. | إعادة استخدام الجدول والنموذج نفسه لكل أحداث Cart Forensics، مع أعمدة فهرسة مرجعية وpayload منظم ومحدود. |
| الاحتفاظ/الاستئناف/الإتلاف | `PosHeldSale` يحتفظ بلقطة payload وحالات `held/resumed/discarded`. | لا تسجل انتقالاته في سجل الأحداث الموحد ولا ترتبط بسلة خادمية. | توسيع `PosHeldSaleService` لتسجيل أحداث السلة باستخدام `cart_id` نفسه، مع الاحتفاظ بصف السلة المعلقة كمصدر حالة المسودة الوحيد. |
| checkout والربط بالفاتورة/الدفع | `PosService` ينفذ فاتورة وسندات قبض ذرياً ويربطهما بـ`PosSession`؛ `CashDrawerService` يسجل محاولات الفتح. | لا يثبت `checkout_started/completed` أو `cart_id`/correlation مع الفاتورة والدفع. | حقن تسجيل حدث ضمن المعاملة الحالية بعد الحراس وقبل/بعد المستندات؛ لا تعديل لمحرك الفاتورة أو الدفع أو دفتر الأستاذ. |
| Reason codes ثنائية اللغة | أسباب نصية حرة لحركة النقد والدرج وبعض العمليات فقط. | لا مصدر منظم قابل للإدارة والتحليل أو نص «أخرى» المقيد. | إضافة كيان `PosReasonCode` مشترك للمؤسسة، قابل للتعطيل، بأسماء عربية وإنجليزية، واستخدام مرجعه في الحدث مع نص إضافي فقط عند `other`. |
| Approval / override | صلاحيتا `sales.minimum_price_override` و`pos.variance.approve` قائمتان. | لا سياسة موحدة `allowed/approval_required/denied` ولا سجل منفذ/معتمد منفصل. | إضافة أساس event-based في `PosSessionEvent` مع سياسة من `PosSettings` وصلاحية `pos.override.approve`؛ لا ربط بمسمى دور. |
| Blind Cash Count | `PosSessionService::close` يحسب expected/difference خادمياً و`acknowledgeDifference` يسجل الاعتماد. | الإغلاق يعيد expected/difference فوراً، ولا سجل إقفال counted أو مسار recount مع اعتماد. | توسيع الجلسة والحقل المورد بإخفاء القيم قبل تثبيت counted عند تفعيل السياسة؛ إنشاء أحداث submitted/revealed/recounted/approved في السجل ذاته، مع رفض تعديل صامت. |
| القراءة الموحدة والفلترة | شاشة أحداث جلسة بسيطة ومسارات منفصلة للحركات والتقرير. | لا API موحدة للسلة/الجهاز/المستخدم/الحدث/القيمة/السبب ولا تفاصيل progressive disclosure. | إضافة خدمة/متحكم read-model يقرأ `PosSessionEvent` فقط ويربط المراجع عند اللزوم؛ لا نسخ فواتير أو مدفوعات أو مرتجعات. |
| Tenant/branch/RBAC | `BaseModel` يطبق TenantScope و`PosSessionEvent` BranchScoped؛ `ApiController::scopeToActiveBranch` يحترم الفروع المسموحة؛ الأدوار المخصصة موجودة. | لا `pos.audit.*` ولا حماية لمسار القراءة الجديد. | إضافة صلاحيات محددة إلى `Rbac::PERMISSIONS` وحمايتها في المسارات؛ استخدام الصلاحيات الفعلية و`allowedBranchIds` فقط. |
| Workspace الرقابة والتدقيق | POS فيه جلسات وتقارير وإعدادات، و`DataTable` يدعم البطاقات على الجوال، وsidebar يدعم `permission`. | لا `/pos/audit` ولا timeline/sheet أو فلاتر قابلة للطي. | إنشاء مساحة واحدة `pos/audit` على مكونات Nebrax الحالية، وربطها بالـsidebar وفق `pos.audit.view` من دون واجهات ثابتة حسب الدور. |
| إعدادات POS | `PosSettings` و`SalesConfigController` هما المصدر الموحد لسياسات POS. | لا blind count أو approval policies، بينما إدارة الأكواد تحتاج سطحاً مستقلاً. | توسيع مفاتيح `PosSettings` وسياسات الإعداد القائمة، وإتاحة إدارة reason codes ضمن تبويب إعدادات Workspace للمستخدم المخول فقط. |

## حدود مقصودة

لا يكتب التنفيذ إلى `journal_entries` أو `journal_lines`، ولا ينشئ قيداً من حدث التدقيق، ولا يغير محركات invoice/payment/return/exchange أو ترحيل المخزون أو ZATCA. كما لا يشمل التقييم الآلي للمخاطر أو اكتشاف الأنماط أو إدارة القضايا أو الذكاء الاصطناعي؛ تبقى هذه امتدادات لاحقة لأن مخطط الأحداث والمراجع سيستوعبها دون إعادة بناء.

## ملاحظات ترحيل وتشغيل

سيكون أي ترحيل جديد إضافياً ولا يعيد كتابة بيانات تاريخية. تبقى الأحداث السابقة قابلة للقراءة من `payload` الحالي، بينما تستفيد الأحداث الجديدة من المراجع المفهرسة. لا يلزم backfill للفواتير أو السلال التاريخية في هذه المرحلة؛ فاختلاق تاريخ تحقيقي غير مسجل سيكون غير أمين رقابياً.

[Issue #525](https://github.com/safwan5001-source/Nebrax/issues/525)

## P1 — نموذج الثقة ومصدر الحقيقة

> **الدليل الخادمي Server-authoritative هو مصدر الحقيقة. Telemetry العميل Client-observed ثانوي وموسوم صراحة، ولا يستخدم أساساً لقرار مالي أو أمني دون تحقق خادمي مستقل.**

| فئة الحدث | التصنيف بعد P1 | مسار الإنشاء | قاعدة الثقة |
| --- | --- | --- | --- |
| `cart_created` | Hybrid | API ينشئ UUID خادمياً، واللقطة الأولية من العميل | هوية السلة خادمية؛ اللقطة موسومة `client_observed_snapshot`. |
| `item_added`, `item_removed`, `item_quantity_changed` | Client-observed only | واجهة POS المحلية | لا توجد حالياً حالة سلة خادمية كاملة يمكن منها اشتقاق before/after؛ تحفظ فقط داخل `client_observed`. |
| `price_overridden`, `discount_applied/changed/removed`, `customer_changed` | Client-observed only | واجهة POS المحلية | يظل السبب والاعتماد خادميي التحقق، أما صورة تعديل السلة فـ telemetry ثانوي. |
| `payment_cancelled` | Client-observed only | واجهة POS قبل إتمام checkout | إلغاء واجهة الدفع لا ينتج مستنداً مالياً؛ يسجل telemetry فقط. |
| `payment_started`, `payment_failed`, `checkout_started`, `checkout_completed` | Server-authoritative | `PosService::checkout()` | لا يسمح endpoint العميل بها. تسجلها الخدمة التي تنفذ البيع بعد تحقق الجلسة، وبمراجع الفاتورة/السداد الواقعية عند الاكتمال. |
| `cart_held`, `cart_resumed`, `cart_discarded` | Server-authoritative | `PosHeldSaleService` ومسار إغلاق الجلسة | تكتب الخدمة التنفيذية الحدث بعد نجاح العملية، ولا يسمح endpoint العميل بها. |
| `override_requested/approved/consumed`, `closing_count_*`, `cash_in/out`, `drawer`, `return`, `exchange` | Server-authoritative | الخدمات التشغيلية القائمة | جميعها تسجل من المسار الذي يغير الحالة أو ينفذ العملية الفعلية. |

يحمل كل حدث جديد `payload.provenance.source` و`trust_level`، ويظهران أيضاً في مورد API. القيم الممكنة هي `server` و`client_observed` و`hybrid`؛ أما السجل التاريخي بلا ختم فهو `legacy_unknown`. لم يُنشأ Server Cart Engine جديد عمداً: يلزم ذلك مرحلة لاحقة قبل ترقية before/after الخاصين بتعديل السلة إلى دليل خادمي كامل.
