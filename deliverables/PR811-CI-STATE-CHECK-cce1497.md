# تقرير: فحص CI الفعلي عند Head `cce1497`

## الخلاصة الحاسمة أولًا

**الفشل الموصوف (`ImportJobInventoryOpeningApplyTest` / `SQLSTATE[55P03]` على صف
`tenants`) غير موجود في أي job فعلي عند هذا الـHead.** فُتح السجل الكامل لكلا الـjob
(pgsql وsqlite) وقُرئ حرفيًا — الفشل الحقيقي الوحيد في كليهما هو **نفسه تمامًا**:
`ReportEffectiveScopeTest` (5 اختبارات)، لا علاقة له بـImportJob ولا بقفل `tenants`.

## ١. الحالة الفعلية عند `cce1497` (فُتحت كل الـjobs، لا تخمين)

يوجد **تشغيلتان منفصلتان** لنفس الـcommit (push + pull_request)، بنتيجتين مختلفتين:

| Run | Trigger | pgsql | sqlite |
|---|---|---|---|
| `34883847492` | push | **PASS** | **PASS** |
| `34883853192` | pull_request (هذا ما يظهر على صفحة الـPR) | **FAIL** | **FAIL** |

في run `34883853192` (الظاهر فعليًا على PR #811):

- **pgsql** (`job 104109480719`): `Tests: 5 failed, 3727 passed (23688 assertions)`
- **sqlite** (`job 104109480978`): `Tests: 5 failed, 39 skipped, 3688 passed (23486 assertions)`

الفشول الخمسة **متطابقة حرفيًا** في كلا المحرّكين:

```
FAILED  ReportEffectiveScopeTest > export unrestricted user…
FAILED  ReportEffectiveScopeTest > export restricted to one…
FAILED  ReportEffectiveScopeTest > export unrestricted user… (سطر آخر)
FAILED  ReportEffectiveScopeTest > inventory value view sco…
FAILED  ReportEffectiveScopeTest > inventory value view unr…
```

مثال (pgsql، السطر الأخير):
```php
at tests/Feature/ReportEffectiveScopeTest.php:808
808: $this->assertSame(12, $row['quantity'], 'Unrestricted owner was unexpectedly
     narrowed on view=value — backward compatibility broken.');
Failed asserting that 0 is identical to 12.
```

**لا وجود إطلاقًا** لـ`ImportJobInventoryOpeningApplyTest` ولا `SQLSTATE[55P03]` ولا
`tenants` في أيٍّ من السجلّين — بحث نصي مباشر في كامل محتوى كل log (254KB لكل واحد)
يؤكّد ذلك.

## ٢. تحقّق من الإصلاح السابق (لأن الطلب افترض أنه غير كافٍ)

بما أن `ImportJobInventoryOpeningApplyTest` **لم يفشل أصلًا** في هذا الـHead (لا في
pgsql ولا في sqlite، لا في run الـpush ولا في run الـpull_request)، فالإصلاح السابق
(commit `3d27771` — `Product::withoutEvents()` في تجهيز الاختبار) **لا يزال يعمل
بلا مشكلة**؛ لا دليل على أنه "لم يجعل الاختبار حتميًا" كما ورد في الطلب.

## السبب الجذري

لا سبب جذري لإصلاحه ضمن `ImportJob` — **لا يوجد عطل هناك حاليًا**. السبب الجذري
الحقيقي وراء **حمرة PR #811 فعليًا الآن** هو `ReportEffectiveScopeTest`، وهو خارج
النطاق الذي حدّده الطلب صراحة (بند 7: "لا تعدّل ... Reports أو أي Scope آخر").

**ملاحظة مهمة إضافية**: كون نفس الـcommit ينجح على push ويفشل على pull_request
بنفس الفشول الخمسة حرفيًا في كلا المحركين معًا — نمطٌ يستحق تحقيقًا منفصلًا (قد
يكون ترتيب تنفيذ مختلفًا بين مسارَي الزناد، أو تلوّثًا بين اختبارات)، لكنه خارج
نطاق هذا الطلب تمامًا.

## القرار

- **لم يُطبَّق أي تعديل على الكود.** لا على `ImportJob*`، لا على `Product*`، ولا
  على `Report*` (ممنوع صراحة). تطبيق أي إصلاح لـImportJob كان سيكون حلًا لعطلٍ
  غير موجود، مخالفًا لتعليمات "لا rerun أعمى ولا إخفاء للمشكلة".
- **لم يُدفَع أي شيء** — لا حاجة، لا تغيير يستحق ذلك.

## الملفات المتغيرة

لا شيء.

## نتائج التكرار

لم تُنفَّذ 20 تكرارًا لـ`ImportJobInventoryOpeningApplyTest` على PostgreSQL ضمن هذه
المهمة، لأن الاختبار المستهدف **لا يفشل في CI الفعلي عند هذا الـHead** ليُعاد إثبات
حتميته — التكرار المطلوب (20× + مجموعة ImportJob) كان جزءًا من المهمة *السابقة*
وأُنجز ووُثِّق حينها (35/35 فشل قبل إصلاح `3d27771`، ثم 25/25 + 72/72 + 342/342
نجاح بعده)، ولم يتغيّر شيء في هذا المسار منذ ذلك الحين.

## CI

- Base: `c152e3ee634be3e7c2bb12db299a5ddd44472558` (main)
- Head: `cce149787a00467b1b079e40a19d580024aabe3b` (بلا تغيير)
- الحالة الفعلية عليه: push run أخضر بالكامل؛ pull_request run أحمر بـ5 فشول في
  `ReportEffectiveScopeTest` على كلا المحرّكين — **وليس** بالفشل الموصوف في الطلب.
- PR #811 **ما زال ممنوع الدمج** كما طُلب — لم يُدمَج ولم يُنشَر.

## المخاطر والمتبقي

- **الحاجز الفعلي أمام PR #811 الآن هو `ReportEffectiveScopeTest`**، لا
  `ImportJobInventoryOpeningApplyTest`. طلبك الحالي استبعد صراحةً لمس Reports —
  فإن أردتَ متابعته، أحتاج إذنًا صريحًا بفتح نطاق `Reports` (أو رابط job محدد آخر
  تريدني أن أفحصه تحديدًا).
- التباين بين نتيجة push ونتيجة pull_request على نفس الـcommit تحديدًا يستحق
  تسجيله كخطر منفصل — نمطٌ غير مفسَّر بعد ولم يُحقَّق فيه هنا (خارج النطاق المحدَّد).
- إن كان لديك رابط job محدد يُظهر فعليًا `ImportJobInventoryOpeningApplyTest`
  فاشلًا (وليس ما ظهر لي عند هذا الـHead)، أرسله مباشرة وسأفتحه فورًا.
