# AWJ B8-1 — عقد محتوى السياسات المترجم في `pages[]` (تقرير التنفيذ)

**Base:** `585691b97a0bd65b848ee0cf12d1e2430b28a8c7` (main) · **الفرع:** `claude/b8-1-policy-bodies` · **No Merge · No Deploy**

## القرار المعتمد (D-4)
Safwan اعتمد **الخيار A** وD-4a…D-4j (نصّ التفاصيل في وثيقة B8 Findings على PR #1755) بشرطين مُلزِمين:
1. **توافق رجعي:** وثائق العرض الحالية وقيم `title` القديمة صالحة وثابتة ما لم تُعدَّل صراحةً؛ **لا مفاتيح افتراضية جديدة** تكسر العقود الذهبية.
2. **قابلية التحرير من لوحة تاجر AWJ:** محرر السياسات **شريحة لاحقة إلزامية (B8-3)** — موثَّقة هنا وفي المتتبّع، **ولا تُنفَّذ في B8-1**.

## النطاق المنفَّذ (B8-1 فقط)
- `pages[]` يقبل مفتاحاً **اختيارياً** `content`: `{ ar?: {title≤80, body≤20000}, en?: {...} }`، **لأربع سياسات فقط**: `shipping-policy`, `privacy-policy`, `returns-policy`, `terms-of-service`.
- **لا مفتاح افتراضي:** يُكتب `content` فقط حين يوجد نص فعلي. لغة غير ar/en، أو غير مصفوفة، أو فارغة ⇒ تسقط؛ على `about/contact/faq` ⇒ يُهمل. الاقتطاع بصمت (نمط المطبِّع الحالي)؛ `title` القديم لم يتغيّر.
- **لا تسريب:** `StorefrontConfigController` (عام `store/v1/storefront`) يستدعي `StorefrontPresentationNormalizer::withoutPolicyContent()` فلا يخرج أي متن. المتون تُخدم لاحقاً من مسار مخصّص (B8-2).
- **إعادة استعمال:** لا جدول ولا هجرة ولا مسار ولا صلاحية: الحفظ/النشر/الإصدارات عبر المسارات القائمة المحروسة بـ`commerce.manage` وعزل المستأجر/المتجر.
- النص **خام** (لا تعقيم الآن)؛ التعقيم عند العرض في B8-2.

## الملفات
| الملف | التغيير |
|---|---|
| `app/Support/Commerce/StorefrontPresentationNormalizer.php` | ثوابت السياسات، `normalizePolicyContent`، `withoutPolicyContent` |
| `app/Http/Controllers/Api/StorefrontConfigController.php` | حجب `content` عن اللقطة العامة |
| `storefront/src/lib/presentation/config.ts`, `web/.../presentation/config.ts` | أنواع + تطبيع متطابق (توأم) |
| `tests/Feature/StorefrontPolicyContentTest.php` | 6 اختبارات PHP |
| `storefront/.../__tests__/policy-content.b8-1.test.ts`, `web/.../__tests__/policy-content.b8-1.test.ts` | 3 اختبارات TS لكلٍّ |
| `docs/plans/store/AWJ_STORE_COMMERCE_HORIZON_TRACKER.md` | B8-1/B8-2/B8-3، D-4 معتمد، X4 **غير مكتملة** |

## الاختبارات (محلياً)
- PHP: `StorefrontPolicyContentTest|StorefrontPresentation|StorefrontConfig|PresentationGolden` → **352 passed, 1 skipped** (تشمل الـgolden fixtures الثلاثة دون تعديل، ونسخ/جدولة/نشر، وPostgres-concurrency حيث متاح).
- storefront vitest: 1564 passed · web: اختبار B8-1 3 passed · `tsc --noEmit` نظيف في الحزمتين.
- الانحدار: وثيقة قديمة بلا `content` تُطبَّع إلى نفسها حرفياً ومتكررة (idempotent)؛ الافتراضي بلا `content`؛ عزل: مستأجر آخر ⇒ 404؛ `staff` ⇒ 403؛ اللقطة العامة لا تحوي المتن لا للمتجر ولا لمتجر آخر.
- لا قيود محاسبية (لا أثر مالي).

## التحديث النهائي (التحقق)
- **رفض التجاوز بدل الاقتطاع:** `StorefrontPresentationPublishValidator::assertIncomingPolicyContent` (422، المسار + الرمز `policy_body_too_long`/`policy_title_too_long`) على حفظ المسودة وحفظ النسخة، قبل التطبيع وأي كتابة؛ والحدّان 20000/80 مقبولان حرفياً. توأم TS: `policyContentIssues()` في `storefront/` و`web/`.
- **اختبارات PHP (`StorefrontPolicyContentTest`): 9 ناجحة** — منها: التجاوز عبر حفظ المسودة (لا كتابة جزئية)، والتجاوز عبر حفظ النسخة (422 دون تغيير صف النسخة أو المسودة أو `revision` أو سجل المراجعات)، والحدود، وعزل المستأجر (404)، وRBAC (403)، وحجب المتن عن اللقطة العامة.
- **فحص أوسع محلياً:** مجموعات presentation/config/golden: 347 ناجحاً، 1 متخطى. storefront vitest + tsc + `biome ci` نظيفة؛ اختبارات web الخاصة بالشريحة ناجحة.
- **SHA:** آخر كود قبل هذا التحديث `31a6cebc2f88a9cae7792eb1fed61d4202c1d84e`؛ رأس الـPR النهائي وحالة CI مثبتان في وصف الـPR وتقرير التسليم (لا يمكن تضمين SHA الالتزام في ملفه).

## ما لم يُنفَّذ (متتبَّع)
- **B8-2:** `GET store/v1/policies/{slug}` + تعقيم HTML (404 عند عدم النشر).
- **B8-3 (إلزامي):** محرر السياسات في Customizer لوحة التاجر (ar/en، معاينة، حدود الطول).
- **X4:** تحويل الواجهة العامة من Spree — بعد B8-2 وB8-3.
- لا تحقق CI/بيئي بعد؛ انظر الـPR.
