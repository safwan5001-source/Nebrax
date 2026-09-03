# تقرير تنفيذ Invoice Visual V2 — Classic V2 بهوية مستقلة

**المشروع:** نبراس / أَوْج ERP  
**المستودع:** `safwan5001-source/Nebrax`  
**التاريخ:** 2026-09-03  
**القاعدة:** فصل هوية `tax-invoice-classic` التاريخية عن تصميم Classic V2 الرسمي عبر سجل مستقل (`tax-invoice-classic-v2` / `classic_v2`). لا migration، لا إعادة كتابة تعيينات/مراجعات، لا محاسبة/ZATCA/schema، لا محرّك عارض ثانٍ، لا دمج، لا نشر. **لا يكتب فوق تقريري Modern وERP.**

---

## 1. Executive Summary

أُضيف قالب **Classic V2** بهوية سجل مستقلة ليبدو مستنداً رسمياً تقليدياً متوسط الكثافة: حشو `p-7` وفواصل `mt-4`، جدول `11px` بقواعد مزدوجة خفيفة، رأس منطقتين بلا مربع شعار ملوّن، طرفان بإطار كلاسيكي (لا بطاقة-لكل-حقل ولا عمود ميتا ثالث)، إجماليات بقاعدة مزدوجة رسمية بلا بطاقة زرقاء، وQR **70px** قرب الملخص. التوكنز في `classic-v2.ts` مستقلة عن Modern V2 وERP V2 وعن `CLASSIC_STYLE` التاريخي.

**عقد الهويات (مانع للدمج إن كُسر):** التجميد يخزّن UUID مراجعة + JSON فيه `template_id` نصي، **لا** يجمّد مكوّن React. لذلك لا يكفي تعديل `composition === 'classic'` in-place — وفرع الـ fallback في الرأس/الأطراف/الملخص/الإجماليات **مشترك مع Retail**:

| الهوية | التركيب | الشكل |
| --- | --- | --- |
| `tax-invoice-classic` | `classic` | **كما هو** — عنوان بلون الهوية، حبة رقم رمادية، شريط `--doc-brand`، ثلاث بطاقات `grid-cols-3`، رأس جدول brand، QR 110px، بلا bilingual |
| `tax-invoice-classic-v2` | `classic_v2` | Formal / Traditional / كثافة متوسطة + Bidi |

لا alias من `tax-invoice-classic` → V2. `DEFAULT_TEMPLATE_ID` يبقى `tax-invoice-classic` (وهو أيضاً سقوط المجهول). المسودة تتبع التعيين الحي؛ المرحّل يتبع `template_id` المجمّد. فروع `classic_v2` أُضيفت **قبل** الـ fallback؛ الـ fallback نفسه لم يُلمس.

العارض بقي كما هو: `InvoiceDocument` → `DocumentView` → `DocumentBody` → `#print-root` / `#pdf-print-root`. لم يُمسّ `document-output-template.ts` دلالياً.

إعادة استخدام آمنة من #616/#618 فقط: `useDocumentLabelMode`، `ModernBilingualLabel`، كتالوج التسميات/العملة (`ريال` / `SAR` / bilingual `SAR`). **لا** نسخ نسب `VISUAL_V2` ولا `ERP_V2` ولا مقاساتهما.

---

## 2. ما تم

| المحور | النتيجة |
| --- | --- |
| أنواع | `'classic_v2'` في `TemplateComposition` |
| أسلوب | `CLASSIC_STYLE` كما هو. `CLASSIC_V2_STYLE` جديد: `p-7` / `mt-4` / `comfortable` / `rounded-none` / `tableHead: plain` / `brandBar: false` |
| مكوّن | `tax-invoice-classic.tsx` يبقى على `CLASSIC_STYLE`. ملف جديد `tax-invoice-classic-v2.tsx` يغلف `DocumentBody` بـ `CLASSIC_V2_STYLE` |
| سجل | `tax-invoice-classic-v2` / `nameKey: classic_v2` / ثيم افتراضي `blue`. الكتالوج والاستوديو يقرآن `listTemplates()` |
| i18n | `invoiceTemplates.classic_v2` = «كلاسيكي V2» / «Classic V2». `/document-qa` يعرض **كلا** `tax-invoice-classic` و`tax-invoice-classic-v2` (الصفحة لم تكن تعرض Classic أصلاً) |
| أقسام | فروع **جديدة** `classic_v2` فقط في header/parties/items/summary/totals/notes/terms/bank/footer/qr/signature/stamp (وvoucher/amount-words للتسميات) |
| طباعة | قواعد `thead`/`break-inside` تحت `[data-doc-composition="classic_v2"]` — لا تُطبَّق على `classic` ولا تُغيَّر قواعد `modern_v2`/`erp_v2` |
| تجميد | بلا تعديل دلالي لـ `document-output-template.ts` (حارس مصدر: الملف بلا ذكر `tax-invoice-classic-v2`) |

---

## 3. كيف حُفظ Classic التاريخي

- فرع الـ fallback في الرأس/الأطراف/الملخص/الإجماليات (المشترك مع **Retail**) بقي حرفياً. فروع `classic_v2` تسبق الـ fallback ولا تعدّله.
- شريط `--doc-brand` (`h-1`) وحبة الرقم الرمادية ورأس الجدول `brand` وثلاث بطاقات `grid-cols-3` ما زالت على `CLASSIC_STYLE` فقط.
- QR الافتراضي لغير V2 يبقى **110px**.
- اختبار الانحدار في `document-classic-v2.test.tsx`: `composition=classic`، ثلاث بطاقات، شريط `h-1`، QR 110، بلا `data-modern-bilingual`.
- توكنز `CLASSIC_STYLE` محروسة في `template-styles.test.ts` (`p-8` / `mt-5` / `rounded-lg` / `tableHead: brand` / `brandBar: true`).

التعيينات الحية الحالية على `tax-invoice-classic` ترجع تلقائياً للشكل القديم لأن العارض يحلّ المعرّف كما هو. V2 خيار كتالوج جديد فقط.

---

## 4. الملفات

| ملف | الدور |
| --- | --- |
| `web/src/modules/documents/presentation/classic-v2.ts` | توكنز Classic V2: شعار 32px، QR 70px، نسب أعمدة 3/8/8/16/**26**/5/8/9/8/9 = **100%** |
| `web/src/modules/documents/presentation/classic-v2.test.ts` | حارس الكثافة والنسب ومقاسات الشعار/QR دون نسخ Modern/ERP |
| `web/src/modules/documents/templates/template-styles.ts` | `CLASSIC_V2_STYLE` + مساعدَا `isClassicV2` / `isLegacyClassic` |
| `web/src/modules/documents/templates/tax-invoice-classic-v2.tsx` | هوية V2 الجديدة |
| `web/src/modules/documents/registry/templates.ts` | سجل الهويتين؛ بلا alias؛ الافتراضي classic |
| `web/src/modules/documents/types/index.ts` | `'classic_v2'` في الاتحاد |
| `web/src/app/globals.css` | قواعد طباعة مقيّدة بـ `classic_v2` (إضافةً إلى `modern_v2`/`erp_v2` دون تغييرهما) |
| `web/src/app/document-qa/page.tsx` | خيارا `tax-invoice-classic` و`tax-invoice-classic-v2` |
| `web/src/messages/ar.json` / `en.json` | `invoiceTemplates.classic_v2` |
| أقسام `doc-header` … `doc-voucher` | فروع `classic_v2` جديدة فقط |
| `document-classic-v2.test.tsx` | تركيب V2 + Bidi + 1/5/20 بنداً + انحدار Classic/Modern V2/ERP V2 |
| `templates.test.ts` / `document-output-template.test.ts` / `live-template-definition.test.ts` / `visual-v2-print.test.ts` | سجل، تجميد، تعريف حي، عزل CSS |

لم يُمسّ: `document-output-template.ts`، `tax-invoice-classic.tsx`، قوالب Modern/ERP/Minimal/Retail/Thermal، PHP، الهجرات، ZATCA generation، تقريري `AWJ_INVOICE_VISUAL_V2_MODERN_IMPLEMENTATION_REPORT.md` و`AWJ_INVOICE_VISUAL_V2_ERP_IMPLEMENTATION_REPORT.md`.

---

## 5. الاختبارات

### Vitest — `npm run test` في `web/`

```
Test Files  196 passed (196)
Tests       1197 passed (1197)
Duration    20.74s
```

منها:

- `templates.test.ts`: `getTemplate('tax-invoice-classic')` ≠ V2؛ المجهول → classic؛ لا alias؛ `DEFAULT_TEMPLATE_ID` ثابت.
- `document-output-template.test.ts`: تجميد classic يبقى تاريخياً حتى لو الحي V2، تجميد classic-v2 يبقى v2 حتى لو الحي تاريخي، المسودة تتبع الحي، الملف بلا ذكر `tax-invoice-classic-v2`.
- `document-classic-v2.test.tsx`: 11 — `data-doc-composition="classic_v2"`، عربي/إنجليزي/ثنائي Bidi، 1/5/20 بنداً، بلا شعار احتياطي، QR 70، أقسام اختيارية تنهار، طرفان بلا بطاقة زرقاء.
- انحدار Classic التاريخي: 3 بطاقات، شريط `h-1`، QR 110، بلا `data-modern-bilingual`.
- انحدار Modern V2 QR **76** وERP V2 QR **64** داخل الملف نفسه.
- `classic-v2.test.ts`: 3 — مجموع نسب الأعمدة **100%**؛ وصف 26% بين Modern 21% وERP 30%؛ QR 70 بين 64 و76؛ شعار 32 بين 28 و36.
- `template-styles.test.ts`: توكنز Classic/ERP/Modern/Minimal/Retail ثابتة؛ `CLASSIC_V2_STYLE` مستقل (`p-7` ≠ `p-8`/`p-5`).
- `visual-v2-print.test.ts`: CSS `modern_v2`/`erp_v2` لم يُمس؛ قواعد `classic_v2` لا تُطبَّق على `classic`.

### PHP

لم يُمسّ backend. **`php artisan test` لم يُشغَّل** — لا هجرات ولا خدمات محاسبية.

### Frontend build

`npm run build` (Next.js 15.5.19) نجح محلياً: Compiled successfully، Lint/types.

---

## 6. Build / CI

| الأمر | النتيجة |
| --- | --- |
| `php artisan test` | غير مشغَّل (لا backend) |
| `npm run test` | 196 ملفاً / **1197** اختباراً |
| `npm run build` | نجح محلياً (Next.js 15.5.19) |
| GitHub CI | يُعاد تشغيله على التزام التقرير؛ لا دمج |

---

## 7. Visual QA المحدود

نُفِّذ عبر Playwright على `/document-qa` محلياً (`http://127.0.0.1:3001`)، **بلا جلسة مستأجر**. لقطات `#qa-print-root` في `/opt/cursor/artifacts/` — أسماء جديدة بلا overwrite. المقاييس في `classic_v2_qa_inspect.json`.

فحص إحداثيات `th`: **صفر تراكب** في السبع لقطات. `tableOverflowPx = 0`. عرض الجذر **794px** (A4). التذييل ظاهر غير مقصوص (هواتف + سطر العينة).

| الملف | السيناريو | المقاييس |
| --- | --- | --- |
| `classic_v2_rtl_ar_five.png` | Classic V2 عربي RTL، 5 بنود | `composition=classic_v2`، طرفان، QR **70**، بلا brand bar، بلا bilingual، ارتفاع 1072 |
| `classic_v2_ltr_en_five.png` | Classic V2 إنجليزي LTR، 5 بنود | عنوان Tax Invoice، وحدة SAR، QR 70، بلا bilingual، ارتفاع 1147 |
| `classic_v2_bilingual_en_rtl_five.png` | Classic V2 bilingual (locale=en + RTL)، 5 بنود | 29 عقدة ثنائية، بلا ` \| `، QR 70، ارتفاع 1289 |
| `classic_v2_rtl_ar_twenty.png` | Classic V2 عربي، 20 بنداً | 20 صفاً، ارتفاع 1947، صفر overflow، تذييل ظاهر |
| `classic_v2_legacy_classic_rtl_ar_five.png` | انحدار `tax-invoice-classic` | `composition=classic`، 3 بطاقات، شريط هوية، QR **110**، بلا `data-doc-keep`، بطاقة إجمالي زرقاء |
| `classic_v2_regression_modern_v2_bilingual_five.png` | انحدار `tax-invoice-modern-v2` | `composition=modern_v2`، QR **76**، 29 عقدة ثنائية، ارتفاع 1292 |
| `classic_v2_regression_erp_v2_rtl_ar_five.png` | انحدار `tax-invoice-erp-v2` | `composition=erp_v2`، QR **64**، ارتفاع 1047 (أكثف من Classic V2) |

ما ظهر في Classic V2:

- رأس منطقتين بقاعدة مزدوجة (`border-b` + `h-px bg-black`)؛ الاسم أقوى من الشعار المسقوف 32px؛ بلا مربع احتياطي عند الغياب.
- طرفان بإطار أسود خفيف؛ الميتا في الرأس لا عمود ثالث.
- الجدول بطل الصفحة؛ الوصف 26% (أوسع من Modern وأضيق من ERP)؛ الخلايا رقم فقط والوحدة في الرأس (`ريال` / `SAR`).
- إجماليات بقاعدة مزدوجة على الإجمالي النهائي — بلا بطاقة Dashboard زرقاء وبلا شريط جانبي أسود (ERP) وبلا فاصل `--doc-brand` (Modern).
- QR 70px بإطار أسود قرب الملخص (`data-doc-keep=summary`).
- تذييل contact-only بهواتف.

ما لم يُنفَّذ:

- نقر طباعة/PDF من شاشة فاتورة مستأجر حقيقي.
- مجموعة Playwright e2e الكاملة (`document-qa.spec.ts`).

---

## 8. Freeze / Assignment

العقد كما هو بعد #616/#618: تجميد = UUID مراجعة + `template_id` نصي داخل JSON التعريف. لا إعادة كتابة بيانات.

| الحالة | السلوك |
| --- | --- |
| مسودة + تعيين حي `tax-invoice-classic` | شكل تاريخي (3 بطاقات + شريط هوية + QR 110) |
| مسودة + تعيين حي `tax-invoice-classic-v2` | Classic V2 |
| مرحّل مجمّد على `tax-invoice-classic` + حي V2 | يبقى تاريخياً |
| مرحّل مجمّد على `tax-invoice-classic-v2` + حي تاريخي | يبقى V2 |
| معرّف مجهول | `getTemplate` → classic |
| Print / PDF | كلا المعرّفين A4 في `listTemplates`؛ PDF يسقط إلى print عند غياب تعيين pdf كما كان |
| Thermal | بلا تغيير؛ القائمة البيضاء `thermal58`/`thermal80` فقط |
| Retail | فرع الـ fallback لم يُلمس؛ لا يتبع `classic_v2` |
| Backend | لم يُمس. `PrintTemplateContract` لا يبيّض معرّفات A4؛ لا migration |

---

## 9. المخاطر والعمل المتبقي

- التخطيط الافتراضي للفاتورة الضريبية ما زال يخفي الملاحظات/البنك/الختم حتى يفعّلها تصميم القالب — قد يظن المراجع أن الأقسام «لا تعمل» على `/document-qa` بنوع `tax_invoice`.
- عشرة أعمدة افتراضية على A4 تبقى كثيفة؛ نسب Classic تخصّص 26% للوصف. تخصيص الأعمدة من المصمّم يبقى صمام الأمان.
- ثنائي اللغة يعتمد locale الواجهة × اتجاه المستند؛ لا حقل API `bilingual`. العرض الثنائي عقدتان معزولتان لا سلسلة `|`.
- خطر خاص بفرع الـ fallback المشترك مع Retail: أي تعديل لاحق على الـ fallback سيصيب Retail أيضاً. فروع `classic_v2` تبقى صريحة ومستقلة.
- Minimal/Retail/Thermal لم يُعاد تصميمها (خارج النطاق).
- التحقق اليدوي على فاتورة مرحّلة بمستأجر تجريبي ما زال مفيداً قبل الدمج: تعيين حي `tax-invoice-classic` يجب أن يظهر تاريخياً؛ اختيار V2 يتم من الكتالوج صراحةً.

---

## 10. الفرع

`cursor/invoice-visual-v2-classic-7cc0` — مُفرَّع من أحدث `origin/main` بعد دمج #618. لا عمل على فرعي Modern/ERP.

---

## 11. PR

[#619](https://github.com/safwan5001-source/Nebrax/pull/619) — Draft. **لا Merge ولا Deploy.**

---

## 12. Base SHA

`eeb59d2085d815b0a092f40e6b7c7cb9f0d46974`  
Merge PR #618: Invoice Visual V2 — ERP V2 بهوية مستقلة.

---

## 13. Implementation SHA vs Head

- **Implementation SHA (كود الهويات والأقسام والاختبارات):** `7e6c472fcb0b92024271162a063521cff06e110b`
- **Head SHA:** التزام تقرير التنفيذ هذا (بعد Vitest وbuild وVisual QA). لا التزام لاحق لمجرد مزامنة الهاش داخل الملف.

---

## 14. الخطوة التالية

مراجعة [#619](https://github.com/safwan5001-source/Nebrax/pull/619) بصرياً على:

- `/document-qa?template=tax-invoice-classic` → الشكل التاريخي (3 بطاقات + شريط هوية)
- `/document-qa?template=tax-invoice-classic-v2` → Classic V2 الرسمي متوسط الكثافة

لم يُدمَج ولم يُنشَر من هذا الوكيل. لا migration لاحقة لهذا الفصل.

---

## Compatibility

| المحور | النتيجة |
| --- | --- |
| Classic التاريخي | فرع الـ fallback حرفي؛ توكنز `CLASSIC_STYLE` ثابتة؛ Retail لم يُصب |
| Modern legacy / V2 | توكنزهما ثابتة؛ CSS `modern_v2` لم يُمس؛ QR 76 |
| ERP legacy / V2 | توكنزهما ثابتة؛ CSS `erp_v2` لم يُمس؛ QR 64 |
| Minimal / Retail / Thermal | لم تُغيَّر |
| عقد التصدير | `#print-root` / `#pdf-print-root` كما في #611–#618 |
| تخطيط الكتل المحفوظ | أعمدة قابلة للضبط ما زالت تُحترم |
| الاتجاه | `model.direction` + `resolveDirection`؛ ثنائي اللغة عند اختلاف locale عن الاتجاه |
| المحاسبة / ZATCA / ICV | **لا تغيير** |

---

## Visual Decisions

| القرار | السبب |
| --- | --- |
| هوية سجل جديدة لا in-place | التجميد يخزّن `template_id` نصياً؛ تعديل `classic` كان سيعيد تفسير المرحّل **وRetail** |
| رسمي تقليدي لا Modern/ERP بلون آخر | Modern متّسع (`p-8`/QR 76)؛ ERP كثيف (`p-5`/QR 64)؛ Classic متوسط (`p-7`/QR 70) |
| نسب أعمدة Classic مستقلة | الوصف 26% بين Modern 21% وERP 30%؛ لا نسخ `VISUAL_V2`/`ERP_V2` |
| بلا مربع شعار ملوّن | الاسم القانوني أقوى؛ الغياب = اسم فقط |
| سقف شعار 32px وQR 70px | بين التاريخي (110) وModern (76) وERP (64) حتى لا يهيمن |
| ميتا المستند في الرأس | ليس شبكة Modern الهوائية ولا بطاقات Classic الثلاث |
| إجماليات بقاعدة مزدوجة رسمية | لا بطاقة زرقاء تاريخية ولا شريط جانبي أسود (ERP) ولا فاصل `--doc-brand` (Modern) |
| قواعد `thead` تحت `[data-doc-composition=classic_v2]` | لا تُطبَّق على التاريخي ولا تُغيَّر `modern_v2`/`erp_v2` |
| اتجاه منطقي `start`/`end` | لا `left`/`right` في توكنز الشعار |

---

## Safety Review

| المحور | النتيجة |
| --- | --- |
| **Tenant Isolation** | لا مسارات API جديدة |
| **Branch isolation** | لا نماذج جديدة |
| **Accounting** | **لا قيد.** لا `LedgerService`. لا كتابة `journal_*` |
| **ZATCA** | QR يُعرض إن وُجد؛ لا توليد TLV/UBL |
| **migrations** | لا |
| **تجميد المراجعات** | العقد كما هو (UUID + `template_id` نصي). لا إعادة كتابة بيانات |

---

## Explicit exclusions respected

Classic التاريخي (شكل) · Modern · ERP · Minimal · Retail · Thermal · ZATCA generation · accounting · API/DB schema · إعادة كتابة التعيينات/المراجعات · migrations · second renderer · Merge · Deploy.

(تسميات V2 تُطبَّق إن اختير `tax-invoice-classic-v2`؛ الهوية التاريخية `tax-invoice-classic` لا تحمل bilingual/Bidi.)

---

## ملحق: الأثر المحاسبي

لا قيد. هذا تغيير عرض لقالب الطباعة فقط.

| العملية | مدين | دائن |
| --- | --- | --- |
| عرض/طباعة/PDF فاتورة Classic / Classic V2 | — | — |
