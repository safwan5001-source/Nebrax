# Cycle 9 — Maintenance, Safety, Reports & Readiness Implementation

> **الحالة:** implemented on branch `fuel-stations-cycle-9-readiness`.
>
> **الحد الحاكم:** هذه الدورة تسجل الحقائق التشغيلية وتعرض الحقائق المالية القائمة، ولا تنشئ قيداً أو فاتورة أو دفعة أو حركة مخزون أو أمراً إلى جهاز مادي.

## الغرض

تضيف Cycle 9 منصة تشغيلية موحدة للصيانة والسلامة والامتثال والتنبيهات والتقارير لمحطات الوقود. وهي تكمل العقود القائمة بدلاً من استبدالها. تستمر الحقيقة المالية في المرور حصراً عبر المسارات المعتمدة: `FuelSale → InvoiceService → PaymentService → Inventory/COGS/Ledger`، ويبقى `FuelOperationalLedger` دليلاً تشغيلياً تفصيلياً بينما يظل `StockMovement` و`InventoryService` مصدر رصيد المخزون الرسمي.

| المجال | ما أُضيف | ما لم يُضف |
|---|---|---|
| الصيانة | جداول مرتبطة بأصل حقيقي، أوامر عمل، سجل lifecycle وتكلفة/توقف تشغيليان | أصل محاسبي جديد، مصروف أو قيد أو تسوية تلقائية |
| السلامة | فحص checklist، findings، إجراءات تصحيحية، تصاريح وشهادات | حكم قانوني تلقائي أو ملف سري أو إصدار مستند حكومي |
| التنبيه | قواعد تشغيلية محفوظة في `FinancialControlAlert` القائم | محرك تنبيه موازٍ أو إصلاح تلقائي للمصدر |
| التقارير | Dashboard وتقارير قراءة فقط من مصادر رسمية أو أدلة تشغيلية محددة | أرقام مالية تشتق من UI-only snapshots أو مسودات |
| التكامل | قراءة حالات أجهزة Cycle 8 والتنبيه عليها | SDK/driver/vendor protocol/MQTT/TCP/webhook أو أمر مضخة |

## نموذج البيانات والعزل

تضيف الهجرة `2025_01_01_000116_create_fuel_station_readiness_operations.php` الجداول التالية، وكل سجل يحمل `tenant_id` و`branch_id` حيث يلزم، ويخضع لـ`BranchScoped` أو `BelongsToBranch` عبر النماذج القائمة.

| الجدول | المصدر/الغرض | الضوابط الأساسية |
|---|---|---|
| `fuel_station_maintenance_schedules` | برنامج صيانة تقويمي أو قائم على runtime/meter | لا schedule usage بدون interval صريح ولا افتراض telemetry |
| `fuel_station_work_orders` | أمر وقائي أو تصحيحي مرتبط بأصل حقيقي | رقم مستند branch-scoped، lifecycle مقفل، لا حذف |
| `fuel_station_safety_inspections` | فحص سلامة مرقم | لا تعديل أو حذف بعد الإغلاق |
| `fuel_station_safety_findings` | نتيجة checklist صريحة | مفتاح checklist فريد لكل فحص؛ fail يحمل severity |
| `fuel_station_safety_corrective_actions` | مسؤولية/استحقاق/حل/تحقق إجراء تصحيحي | لا إغلاق قبل الانتقالات المنظمة؛ لا حذف |
| `fuel_station_safety_permits` | تصريح أو شهادة ونافذة انتهاء | مرجع فريد للمستأجر؛ لا حذف |
| `fuel_station_readiness_events` | سجل تدقيق append-only | before/after/reason/actor/time؛ لا تعديل أو حذف |

تستخدم الصيانة والسلامة مرجعاً polymorphic محكوماً إلى واحد من: `FuelStation` أو `FuelTank` أو `FuelPump` أو `FuelNozzle` أو `FuelStationDevice` أو `Asset`. لا يقبل المجال اسم جدول من العميل. تتحقق الخدمة من ملكية المستأجر، وتطابق المحطة للأصول التشغيلية، وتطابق الفرع للأصل المحاسبي. لذلك لا يوجد جدول “معدات محطة” موازٍ أو نسخ لهوية المضخة/الخزان/الجهاز.

## LIfecycles

### أوامر الصيانة

| الترتيب | الحالة | شرط الانتقال |
|---:|---|---|
| 1 | `reported` | إنشاء الأمر |
| 2 | `triaged` | فرز مسؤول الصيانة |
| 3 | `scheduled` | موعد صريح مطلوب |
| 4 | `in_progress` | بدء العمل |
| 5 | `completed` | حل صريح، وكلفة/توقف غير سالبين إن سُجلت |
| 6 | `verified` | تحقق مستخدم مخول |
| 7 | `closed` | إغلاق بعد التحقق فقط |

إذا ارتبط أمر مغلق بجدول تقويمي نشط، تحدث الخدمة `last_completed_at` و`next_due_at` داخل المعاملة نفسها. لا تستنتج دورة runtime/meter موعداً من دون دليل قياس معتمد.

### السلامة والإجراءات التصحيحية

تتحرك فحوص السلامة من `scheduled → performed → verified → closed`. ويتطلب `performed` checklist غير فارغاً ومفاتيح غير مكررة. لا يتحقق فحص يحوي finding بنتيجة `fail` إلا إذا وُجد إجراء تصحيحي واحد على الأقل لكل finding فاشل، وكان كل إجراء منه مغلقاً.

يتحرك الإجراء التصحيحي من `open → in_progress → completed → verified → closed`. يتطلب الاكتمال resolution صريحاً ويثبت التحقق المستخدم والوقت. لا يساوي acknowledge تنبيه إغلاق الإجراء أو تحقق الفحص.

## تنبيهات التشغيل

لا تنشئ Cycle 9 جدول تنبيهات جديداً. تعيد استخدام `FinancialControlAlert`، وتضيف فقط حقلَي `assigned_to` و`assignment_reason` الاختياريين القابلين للاستعمال في جميع التنبيهات. كل تنبيه Fuel يحمل rule يبدأ بـ`fuel.` وfingerprint ثابتاً ومرجع المصدر ومحطة الوقود داخل `details.fuel_station_id`.

| القاعدة | المصدر | النتيجة |
|---|---|---|
| `fuel.maintenance.overdue` | schedule تقويمي نشط تجاوز `next_due_at` | high |
| `fuel.maintenance.work_order_overdue` | أمر مفتوح بموعد مجدول فات | high أو critical حسب الأولوية |
| `fuel.safety.corrective_action_overdue` | إجراء غير مغلق تجاوز due date | high |
| `fuel.safety.permit_expiring` | تصريح نشط قرب/تجاوز انتهاءه | medium أو critical |
| `fuel.device.sync_failed` | صحة/مزامنة جهاز Cycle 8 متدهورة | high |
| `fuel.device.stale` | آخر دليل جهاز خارج نافذة offline policy | medium |

الفحص يدوي عبر API محروس بصلاحية مخصصة. يمكن للمخول إقرار التنبيه أو إسناده لمستخدم من المستأجر نفسه، ويُسجل كلا الفعلين في `fuel_station_readiness_events`. لا scheduler أو daemon أو retry خارجي في هذه الدورة. لا يعدّل scan المصدر؛ يزامن حالة التنبيه أو يحل التنبيه عند زوال السبب فقط.

## إعدادات وسياسات

تضاف مفاتيح Cycle 9 داخل مجموعة `fuel_stations` القائمة، فتأخذ ترتيب الوراثة المعتمد tenant ثم station ثم device حيث ينطبق، وتُسجل التعديلات في audit trail الخاص بالإعدادات.

| المفتاح | الافتراضي | الغرض |
|---|---:|---|
| `maintenance_default_calendar_interval_days` | 30 | مرجع سياسة تقويمية، دون توليد أمر تلقائي |
| `maintenance_overdue_alerts_enabled` | true | سياسة قابلية ضبط التنبيه التشغيلي |
| `safety_permit_expiry_warning_days` | 30 | نافذة تحذير التصريح/الشهادة |
| `safety_inspection_overdue_alerts_enabled` | true | سياسة جاهزية فحوص السلامة |
| `fuel_station_alerts_enabled` | true | سياسة تنبيهات المحطة |
| `reports_operational_cutoff_minutes` | 0 | وصف سياسة cutoff للتقارير |
| `reports_volume_basis` | observed | observed أو standard |
| `reports_temperature_basis` | observed | observed أو normalized |

## RBAC والـEntitlement

تُستعمل بوابة التطبيق التجارية القائمة فقط: `fuel_stations.maintenance`، التي أصبحت `built` وتعتمد على `fuel_stations.core`. لا يترتب على ظهور عنصر الشريط الجانبي منح صلاحية API.

| المجال | صلاحيات دقيقة |
|---|---|
| الصيانة | `fuel.maintenance.view`, `fuel.maintenance.manage`, `fuel.maintenance.transition` |
| السلامة | `fuel.safety.view`, `fuel.safety.manage`, `fuel.safety.inspect`, `fuel.safety.verify` |
| التنبيهات | `fuel.alerts.view`, `fuel.alerts.manage` |
| التقارير | `fuel.reports.view` |

## واجهة الـAPI

جميع المسارات تمر عبر RBAC و`fuel_stations.maintenance` entitlement. تظل واجهات الإعدادات على خدمة الإعدادات القائمة، ولا تقبل الواجهة endpoint لتشغيل جهاز أو حفظ secret.

| المسار | الهدف |
|---|---|
| `GET /fuel-stations/maintenance` | جداول الصيانة وأوامر العمل |
| `POST /fuel-stations/maintenance/schedules` | إنشاء برنامج صيانة |
| `POST /fuel-stations/maintenance/work-orders` | الإبلاغ عن أمر عمل |
| `POST /fuel-stations/maintenance/work-orders/{id}/transition` | انتقال lifecycle مقيد |
| `GET /fuel-stations/safety` | الفحوص والتصاريح |
| `POST /fuel-stations/safety/inspections` | جدولة فحص |
| `POST /fuel-stations/safety/inspections/{id}/perform` | تسجيل checklist/findings |
| `POST /fuel-stations/safety/findings/{id}/corrective-actions` | فتح إجراء تصحيحي |
| `POST /fuel-stations/safety/corrective-actions/{id}/transition` | انتقال الإجراء التصحيحي |
| `POST /fuel-stations/safety/inspections/{id}/verify` | تحقق الفحص |
| `POST /fuel-stations/safety/inspections/{id}/close` | إغلاق فحص متحقق |
| `POST /fuel-stations/safety/permits` | تسجيل تصريح/شهادة |
| `GET /fuel-stations/alerts` و`POST /fuel-stations/alerts/scan` | عرض/فحص التنبيهات |
| `POST /fuel-stations/alerts/{id}/acknowledge` و`/assign` | إقرار أو إسناد تنبيه تشغيلي مدقق |
| `GET /fuel-stations/dashboard` | لوحة قيادة تنفيذية قراءة فقط |
| `GET /fuel-stations/reports/{family}` | families: sales, inventory, profitability, fleet, avi, devices, maintenance, safety |

## مصادر التقارير

| العائلة | مصدر الحقيقة |
|---|---|
| sales / profitability / fleet | `FuelSale` النهائي فقط، مع `gross_minor` و`cogs_minor` المسجلين رسمياً |
| inventory | `FuelOperationalLedger` كدليل تشغيل؛ ويبقى الرصيد الدفتري الرسمي في `StockMovement`/`InventoryService` |
| AVI/RFID | `FuelAviAuthorization` وقراره/سبب الرفض/إشارات الاشتباه |
| devices | سجل أجهزة وأحداث Cycle 8، بما فيها health وsync status |
| maintenance | أوامر العمل والجداول المدققة |
| safety | فحوص السلامة والإجراءات والتصاريح |

لا تعرض لوحة القيادة “أيام المتبقي في الخزان” كتقدير مصطنع؛ تعيد `null` حتى يوجد أساس استهلاك/حرارة موثوق ومعتمد.

## المراجعة المحاسبية والحدود المؤجلة

المجال لا يرحل أي مستند. `cost_minor` على أمر العمل هو رقم تشغيلي/دليل، وليس مصروفاً أو قيداً. لا يعالج Cycle 9 فرق النقد أو COGS أو GRNI أو تقييم المخزون أو الحسم أو accrual من تلقاء نفسه. أي مصروف صيانة رسمي مستقبلي يمر بمسار المصروفات/الشراء المالي القائم، ويظل أي تطابق بينه وبين أمر العمل مرجعاً صريحاً في دورة لاحقة.

المؤجل صراحةً: SDK أو بروتوكول مورد حقيقي، gateway دائم، TCP/MQTT/webhook، أوامر المضخة، credentials أو vault/mTLS، daemon أو job دوري، preventive scheduling مدفوع بتشغيل حقيقي، reconciliation مادي أو مالي تلقائي، وتصدير تنظيمي متخصص لم تتحدد مواصفته بعد.

## الاختبارات

تغطي `FuelStationReadinessTest` ملكية الأصل، lifecycle أمر العمل، منع الأثر المالي، trace audit، شرط corrective action قبل safety verification، وتنبيه التصاريح. وتغطي `FuelStationReadinessApiTest` entitlement `fuel_stations.maintenance` ورفض RBAC المحدود والوصول التنفيذي إلى Dashboard وواجهة الإنشاء. يظل تشغيل PHPUnit متوقفاً على توفر PHP/Laravel runtime، بينما فحص TypeScript و`git diff --check` يشغّلان في البيئة الحالية.
