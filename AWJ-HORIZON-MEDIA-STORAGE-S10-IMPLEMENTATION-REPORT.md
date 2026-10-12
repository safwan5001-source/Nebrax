# AWJ-HORIZON-MEDIA-STORAGE — S10 Implementation Report

> **الشريحة:** S10 — إغلاق ثغرة عزل في الربط الضمني للمسار (اكتُشفت بفحص Tenant Isolation الإنتاجي لمركز المستندات).

## 1. الاكتشاف (Production، مستأجرا الاختبار A وB بعد إسناد الاستحقاق للاثنين)

| الطلب (توكن B على موارد A) | المتوقع | الفعلي |
|---|---|---|
| `GET document-batches/{A}/review` · `…/diagnostics` · `GET document-files/{A}/download-url` | 404 | 404 ✅ |
| `POST document-batches/{A: received}/files` | 404 | **422** «لا تقبل الحزمة ملفات في حالتها الحالية» ❌ |
| `POST document-batches/{A: received}/complete` | 404 | **422** «يجب أن تكون الحزمة قيد الاستقبال…» ❌ |
| `POST document-batches/{A: draft}/files` | 404 | 404 لكن من `firstOrFail()` داخل معاملة الخدمة **بعد** تجاوز فحص الحالة ❌ |
| معرّف غير موجود | 404 | 404 (رسالة تحمل المعرّف) |

**الدلالة:** الاستجابة 422 مقابل 404 تكشف لمستأجر آخر **وجود** حزمة مستأجر A و**حالتها**؛ والمسار المسودّة يبيّن أن الخدمة (`DocumentFileIntakeService::ingest`) نُفِّذت على نموذج لا يملكه المستأجر B.

## 2. السبب الجذري

`api` group يشغّل `SubstituteBindings` **قبل** `SetTenant` (وسيط مسار المجموعة). وقت الربط لا يكون `TenantContext` مضبوطاً فيصمت `TenantScope` (`if ($ctx->has())`) فيُحمَّل النموذج بلا قيد مستأجر. المسارات التي تجلب النموذج بنفسها بعد `SetTenant` (review/diagnostics/download-url) سليمة؛ المسارات ذات الربط الضمني للنموذج في التوقيع (`DocumentBatch $batch` …) تتجاوز العزل حتى تصل الخدمة.

اختبار المصفوفة القائم (`DocumentCenterIsolationMatrixTest`) لم يكشفه لأن `TenantContext` singleton يبقى مضبوطاً بين الطلبات داخل الاختبار الواحد فيُقيّد الربط — بينما كل طلب إنتاجي يبدأ بسياق فارغ.

## 3. الإصلاح (حدّ أدنى، شامل لكل نماذج الأعمال)

`BaseModel::resolveRouteBindingQuery()`: حين لا يكون `TenantContext` مضبوطاً وقت الربط يُضاف `where {table}.tenant_id = <tenant_id للمستخدم المصادَق>`. لا أثر حين يكون السياق مضبوطاً (يعمل `TenantScope` كما كان)، ولا أثر لمن لا يحمل `tenant_id` (مدير المنصة). (تم الدمج مع `HasUuids::resolveRouteBindingQuery` عبر alias لأن الـtrait نفسه يعرّفه.)

## 4. الاختبار

`DocumentCenterIntakeCrossTenantTest` (2) يمسح السياق قبل كل طلب (محاكاة الإنتاج): B لا يرفع إلى مسودة A ولا يغيّر التخزين (404)، ولا يحصل على 422 على حزمة A المستلمة عبر `files/complete/review-changes/assign-reviewer/complete-review/eligible-reviewers`. فشل قبل الإصلاح (422) ونجح بعده.

## 5. أثر الإصلاح على الإنتاج/التوافق

لا migration ولا تغيير مالي ولا تغيير واجهة. يضيق الربط فقط على مستأجر المستخدم نفسه (وهو ما كان `SetTenant` سيفرضه لاحقاً).

## 6. ما لا يغطيه هذا الإصلاح (يبقى للمراقبة)

نماذج بلا `tenant_id` أو لا ترث `BaseModel` لا تتأثر بهذا الإصلاح (لم تُجرد هنا).
