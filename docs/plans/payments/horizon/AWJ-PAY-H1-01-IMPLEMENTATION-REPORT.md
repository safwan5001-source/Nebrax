# PAY-H1-01 — Implementation Report

STATUS: **IN REVIEW** (PR مفتوح، غير مدموج، غير منشور)
DATE: 2026-10-22

## Outcome

اتصال بوابة الدفع (`PaymentGateway`) صار قابلاً للإدارة بأمان: دورة حياة، تدوير أسرار بنافذة سماح، حذف لا يمحو ربطاً مالياً، سجل تدقيق ثابت، وصلاحية مستقلة `payment_gateways.manage` (owner/admin). **لا أثر محاسبي** — لا قيود ولا سندات.

## Repository evidence / root cause

- `PaymentGateway` موجود بلا أي مسار أو واجهة (PAY-V2-3)، وحذفه الفعلي يصفّر `payments.payment_gateway_id` (`nullOnDelete`) فيمحو ربط سندات مرحَّلة (C-05).
- لا نافذة سماح لتدوير سر الـwebhook (C-12)، ولا تدقيق لأي تغيير في الاتصال.
- الأسرار مشفّرة بـ`encrypted` cast (النمط الوحيد في المستودع) — يبقى.

## Approach chosen

| القرار | السبب |
|---|---|
| حقول الحياة (`status`، `credential_version`، `webhook_key`…) خارج `$fillable` وتُكتب عبر الخدمة وحدها | منع التزوير بالإسناد الجماعي |
| `is_active` يبقى كما هو؛ الاستخدام الفعلي `isUsable()` = `status=active` **و** `is_active` | توافق رجعي: اختبارات وسلوك قائم يعتمدان على `is_active` |
| الصفوف القائمة تُثبَّت في الهجرة على حالتها الفعلية (`is_active` ⇒ active وإلا suspended) | لا يتغير سلوك أي مستأجر |
| تفعيل مزوّد حقيقي يتطلب `verified_at`؛ `custom` (ربط محاسبي يدوي بلا مزوّد) يُفعَّل مباشرة | لا اتصال حقيقي يصير `active` دون تحقق بمحوّل المزوّد (يصل في PAY-H1-03) |
| الإلغاء (revoke) نهائي ويمحو الأسرار؛ السبب إلزامي | الاتصال يبقى مرجعاً تاريخياً بلا بيانات اعتماد |
| الحذف الفعلي لغير المرجعي وغير المفعّل فقط، بحارس في **النموذج** والخدمة | يغطي أي مسار `->delete()` |
| `payment_connection_events` بلا FK على البوابة وبدقة ميكروثانية | يبقى أثر مسودة محذوفة؛ ترتيب ثابت للأحداث |
| أسماء الحقول المتغيّرة فقط في التدقيق | لا قيمة سرّ ولا طولها |

### انحرافات صريحة عن صف الطابور (تُسجَّل في الطابور عند الدمج)

- **`verify` و`testing` مؤجلان إلى PAY-H1-03:** لا يوجد سجل محوّلات بعد، وإنشاء `verify` شكلي يزيّف التحقق. بدلاً منه بوابة `verified_at` أعلاه.
- **قائمة المزوّدين لم تُوسَّع:** أسماء Moyasar/HyperPay… تُضاف مع محوّلها (D-01 عند G1).
- **`provider_account_ref`** يخص نمط المنصة (PAY-H7-01).

## Changed files

- `database/migrations/2026_11_23_010000_harden_payment_gateway_connections.php` — أعمدة إضافية + backfill + جدول التدقيق؛ `down()` يرفض متى وُجدت أحداث.
- `app/Models/PaymentGateway.php` — ثوابت الحالة، `isUsable()`، `hasFinancialReferences()`، `webhookSecretsForVerification()`، حارس الحذف، إخفاء `webhook_key`/السر السابق.
- `app/Models/PaymentConnectionEvent.php` (جديد، `CompanyWide`، append-only).
- `app/Support/PaymentGatewayException.php` (جديد، يرث `DomainException`، يحمل `reason`).
- `app/Services/PaymentGatewayService.php` — الدورة الكاملة، قفل الصف، التدقيق.
- `app/Http/Controllers/Api/PaymentGatewayController.php` + 4 FormRequests + `PaymentGatewayResource` (حقول إضافية).
- `app/Support/Rbac.php` (`payment_gateways.manage` في الكتالوج فقط، لا `MATRIX`)، `routes/api.php` (10 مسارات).
- `web/src/modules/roles/risk.ts`، `web/src/messages/{ar,en}.json` — تسمية الصلاحية فقط.
- `tests/Feature/PaymentGatewayConnectionTest.php`، `tests/Feature/PaymentGatewayApiTest.php`.

## Tests and exact results

محلياً (SQLite، PHP 8.3):

- الاختبارات الجديدة: `PaymentGatewayConnectionTest` (25) + `PaymentGatewayApiTest` (10) — **35 ناجحاً**. تغطي: الحالة والتفعيل والإيقاف والإلغاء، الحذف المرجعي (سند/تسوية)، التدوير ونافذة السماح، عدم تسرب الأسرار، العزل بين المستأجرين، الصلاحيات (محاسب/مستأجر آخر/غير مصادَق)، التدقيق الثابت وترتيبه، backfill الهجرة ورفض تراجعها، وصفر `Payment`/`JournalEntry`.
- المجموعة ذات الصلة بعد آخر تعديل: `PaymentGateway|BranchIsolationGuard|CustomerRefund|PaymentReversal|ApiUnauthenticated` — **139 ناجحاً (903 assertion)**، منها اختبارات PAY-V2-3/V2-5 القائمة بلا تعديل.
- المجموعة الكاملة `php artisan test` (قبل تعديل دقة الميكروثانية الأخير): **8176 ناجحاً، 164 متخطّى، 26 فاشلاً** — كلها في اختبارات `Fuel*` (`FuelCostBasisService.php:80,380`) لغياب امتداد `bcmath` من بيئة التطوير المحلية (تحذير `setup.sh` المعلن)، ويثبّته CI. لا فشل خارج `Fuel*`.
- PostgreSQL: لم يُشغَّل محلياً — يغطيه CI.
- Web: `vitest` للأدوار ومعادلة اللغات — **78 ناجحاً**.

## Build / lint / typecheck

- `npm run build` (web/): **نجح** (Next.js 15، بلا أخطاء). لا تغيير في `storefront/`.

## CI

PENDING_CI

## Pre-merge review

- PRE_MERGE_REVIEW: PENDING
- Reviewed Head SHA: —

## Merge / Post-merge

- Merge status: لم يُدمج — بانتظار موافقة المالك. لا Deploy.
- POST_MERGE_REVIEW: —

## Self-review

### Implementer
أصغر تنفيذ يغطي الاعتماد، بلا تغيير في `PaymentService`/`LedgerService`/التسوية. مسار `update` القديم للأسرار ما زال يعمل لكنه صار يمرّ بالإصدار والتدقيق.

### Reviewer
- ترتيب الأقفال: الصف المقفول أولاً ثم الحدث؛ لا تعارض مع مِرساة المستأجر لأن لا ترحيل هنا.
- الرفض لا يكتب حدثاً؛ تكرار `suspend`/`revoke` idempotent بلا حدث.
- ترتيب الأحداث حتمي بدقة الميكروثانية.

### AWJ Guardian
- **عزل المستأجر:** كل المسارات تحت `SetTenant` + `TenantScope`؛ مستأجر آخر ⇒ 404 على كل نقطة (مختبَر). الخدمة ترفض نموذجاً من مستأجر آخر.
- **الأسرار:** لا تظهر في أي استجابة/تدقيق/JSON؛ `webhook_key` لحامل `payment_gateways.manage` فقط.
- **المحاسبة:** صفر `Payment`/`JournalEntry` عبر كل العمليات (مختبَر). ضريبة/ZATCA بلا مساس.
- **التوافق:** اختبارات PAY-V2-3/V2-5 القائمة بلا تعديل وتمر.

## Accounting impact

لا يوجد. لا عملية مالية جديدة ⇒ لا قيود ناتجة.

## Tenant / branch isolation impact

`PaymentConnectionEvent` و`PaymentGateway` `CompanyWide` (حارس تصنيف الفروع يمرّ). فحص المراجع المالية للحذف يشمل كل الفروع بنطاق المستأجر.

## Security / authorization impact

صلاحية جديدة مستقلة؛ المحاسب يقرأ دون أسرار ولا يرى `webhook_key` ولا يدير. لا استدعاء شبكي.

## Backward compatibility

إضافي فقط. الصفوف القائمة تحتفظ بسلوكها (active/suspended حسب `is_active`). `PaymentGatewayService::create/update/delete` تقبل `?User $actor` اختيارياً. الحذف صار يرفض الاتصال المرجعي والمفعّل (لم يكن له مسار HTTP من قبل).

## API / DB / migration impact

10 مسارات جديدة تحت `/api/payment-gateways`. هجرة إضافية: 10 أعمدة على `payment_gateways` + جدول `payment_connection_events`. التراجع يرفض عند وجود أحداث (إصلاح إلى الأمام).

## External research used

لا جديد في هذه الشريحة.

## Risks / remaining work

- **حذف جماعي/SQL خام** أو حذف المستأجر (CASCADE) يتجاوز حارس النموذج. حماية على مستوى القاعدة (مُشغّل) تُنظر في PAY-H8-01.
- اتصال غير `custom` موقوف لا يمكن إعادة تفعيله قبل `verify` (PAY-H1-03).

## Discovered backlog

| ID | البند | الأولوية | المالك/المهمة | معيار الإغلاق |
|---|---|---|---|---|
| B-1 | `PaymentService` يقبل ربط سند مسودة ببوابة موقوفة/ملغاة (لا مسار HTTP يمرّ بذلك اليوم) | P2 | PAY-H1-03 | المنسّق يشترط `isUsable()` للمحاولات الجديدة؛ قرار هل يُحصَّن `PaymentService` |
| B-2 | `hasFinancialReferences()` يجب أن يشمل `payment_attempts` و`invoice_payment_requests` و`payment_refund_attempts` عند وصولها | P0 | H1-03، H2-02، H3-01 | اختبار حذف مرجعي لكل جدول جديد |
| B-3 | المحاولات المرفوضة (تفعيل بلا تحقق…) غير مدقَّقة؛ النجاح فقط | P2 | H8-01 | قرار هل تُسجَّل |

## Git state

- Branch: `claude/awj-payments-h1-01-connection`
- PR: —
- Base SHA: `80cbb3c5f394de338c9a9917d3c9d635a8108113`
- Head SHA: —

## Recommended next dependency-ready task

PAY-H1-02 (ضوابط تفعيل المدفوعات). PAY-H1-03 تنتظر H1-01 وH1-02 مدموجين.
