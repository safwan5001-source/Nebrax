# تقرير تنفيذ Invoice Visual V2 — ERP V2 بهوية مستقلة

**المشروع:** نبراس / أَوْج ERP  
**المستودع:** `safwan5001-source/Nebrax`  
**التاريخ:** 2026-09-02  
**القاعدة:** فصل هوية `tax-invoice-erp` التاريخية عن تصميم ERP V2 الكثيف عبر سجل مستقل (`tax-invoice-erp-v2` / `erp_v2`). لا migration، لا إعادة كتابة تعيينات/مراجعات، لا محاسبة/ZATCA/schema، لا محرّك عارض ثانٍ، لا دمج، لا نشر. **لا يكتب فوق تقرير Modern.**

---

## 1. Executive Summary

أُضيف قالب **ERP V2** بهوية سجل مستقلة ليبدو دفتر يومي كثيف: حشو `p-5` وفواصل `mt-3`، جدول `10px` بحدود سوداء رفيعة، رأس قانوني مضغوط بلا مربع شعار ملوّن، طرفان بلا عمود ميتا ثالث، إجماليات دفترية بقاعدة مزدوجة سوداء، وQR **64px** قرب الملخص. التوكنز في `erp-v2.ts` مستقلة عن Modern V2.

**عقد الهويات (مانع للدمج إن كُسر):** التجميد يخزّن UUID مراجعة + JSON فيه `template_id` نصي، **لا** يجمّد مكوّن React. لذلك لا يكفي تعديل `composition === 'erp'` in-place:

| الهوية | التركيب | الشكل |
| --- | --- | --- |
| `tax-invoice-erp` | `erp` | **كما هو** — رأس أسود + شريط هوية، 3 مناطق أطراف، مربع شعار احتياطي، عمود إجمالي `brand-soft`، QR 110px، بلا bilingual |
| `tax-invoice-erp-v2` | `erp_v2` | Dense / table-first / رسمي يومي + Bidi |

لا alias من `tax-invoice-erp` → V2. `DEFAULT_TEMPLATE_ID` يبقى `tax-invoice-classic`. المسودة تتبع التعيين الحي؛ المرحّل يتبع `template_id` المجمّد. فروع `style.composition === 'erp'` **لم تُعدَّل**.

العارض بقي كما هو: `InvoiceDocument` → `DocumentView` → `DocumentBody` → `#print-root` / `#pdf-print-root`. لم يُمسّ `document-output-template.ts` دلالياً.

إعادة استخدام آمنة من #616 فقط: `useDocumentLabelMode`، `ModernBilingualLabel`، كتالوج التسميات/العملة (`ريال` / `SAR` / bilingual `SAR`). **لا** نسخ نسب أعمدة Modern ولا `MODERN_STYLE` ولا رأس Modern ذي العمودين الهوائيين.

---

## 2. ما تم

| المحور | النتيجة |
| --- | --- |
| أنواع | `'erp_v2'` في `TemplateComposition` |
| أسلوب | `ERP_STYLE` كما هو. `ERP_V2_STYLE` جديد: `p-5` / `mt-3` / `compact` / `rounded-none` / `tableHead: plain` / `brandBar: false` |
| مكوّن | `tax-invoice-erp.tsx` يبقى على `ERP_STYLE`. ملف جديد `tax-invoice-erp-v2.tsx` يغلف `DocumentBody` بـ `ERP_V2_STYLE` |
| سجل | `tax-invoice-erp-v2` / `nameKey: erp_v2` / ثيم افتراضي `gray`. الكتالوج والاستوديو يقرآن `listTemplates()` |
| i18n | `invoiceTemplates.erp_v2` = «ERP V2» في `ar.json`/`en.json`. خيار في `/document-qa` |
| أقسام | فروع **جديدة** `erp_v2` فقط في header/parties/items/summary/totals/notes/terms/bank/footer/qr/signature/stamp (وvoucher/amount-words للتسميات) |
| طباعة | قواعد `thead`/`break-inside` تحت `[data-doc-composition="erp_v2"]` — لا تُطبَّق على `erp` ولا تُغيَّر قواعد `modern_v2` |
| تجميد | بلا تعديل دلالي لـ `document-output-template.ts` (حارس مصدر: الملف بلا ذكر `tax-invoice-erp-v2`) |

---

## 3. كيف حُفظ ERP التاريخي

- فرع `if (style.composition === 'erp')` في الرأس/الأطراف/الملخص بقي حرفياً قبل فرع `erp_v2` الجديد.
- عمود الإجمالي `bg-[color:var(--doc-brand-soft)]` ما زال مشروطاً بـ `composition === 'erp'` فقط.
- QR الافتراضي لغير V2 يبقى **110px**؛ شريط `--doc-brand` في الرأس التاريخي لم يُحذف.
- اختبار الانحدار في `document-modern.test.tsx` ما زال يفرض: 3 مناطق أطراف، مربع شعار `.h-14`، بلا `data-modern-bilingual`.
- اختبار إضافي في `document-erp-v2.test.tsx`: `composition=erp`، شريط `h-1`، QR 110، عمود `brand-soft`، بلا `erp_v2`.
- توكنز `ERP_STYLE` محروسة في `template-styles.test.ts` (`p-6` / `mt-4` / `brandBar: true`).

التعيينات الحية الحالية على `tax-invoice-erp` ترجع تلقائياً للشكل القديم لأن العارض يحلّ المعرّف كما هو. V2 خيار كتالوج جديد فقط.

---

## 4. الملفات

| ملف | الدور |
| --- | --- |
| `web/src/modules/documents/presentation/erp-v2.ts` | توكنز ERP V2: شعار 28px، QR 64px، نسب أعمدة 3/7/7/15/**30**/5/7/8/7/11 = **100%** |
| `web/src/modules/documents/presentation/erp-v2.test.ts` | حارس الكثافة والنسب ومقاسات الشعار/QR دون نسخ Modern |
| `web/src/modules/documents/templates/template-styles.ts` | `ERP_V2_STYLE` + مساعدَا `isErpV2` / `isLegacyErp` |
| `web/src/modules/documents/templates/tax-invoice-erp-v2.tsx` | هوية V2 الجديدة |
| `web/src/modules/documents/registry/templates.ts` | سجل الهويتين؛ بلا alias؛ الافتراضي classic |
| `web/src/modules/documents/types/index.ts` | `'erp_v2'` في الاتحاد |
| `web/src/app/globals.css` | قواعد طباعة مقيّدة بـ `erp_v2` (إضافةً إلى `modern_v2` دون تغييرها) |
| `web/src/app/document-qa/page.tsx` | خيار `tax-invoice-erp-v2`؛ ثيم gray لـ erp وerp-v2 |
| `web/src/messages/ar.json` / `en.json` | `invoiceTemplates.erp_v2` |
| أقسام `doc-header` … `doc-voucher` | فروع `erp_v2` جديدة فقط |
| `document-erp-v2.test.tsx` | تركيب V2 + Bidi + 1/5/20 بنداً + انحدار ERP/Modern V2 |
| `templates.test.ts` / `document-output-template.test.ts` / `live-template-definition.test.ts` / `visual-v2-print.test.ts` | سجل، تجميد، تعريف حي، عزل CSS |

لم يُمسّ: `document-output-template.ts`، `tax-invoice-erp.tsx`، قوالب Classic/Minimal/Retail/Thermal/Modern، PHP، الهجرات، ZATCA generation.

---

## 5. الاختبارات

### Vitest — `npm run test` في `web/`

```
Test Files  194 passed (194)
Tests       1176 passed (1176)
Duration    22.21s
```

منها:

- `templates.test.ts`: `getTemplate('tax-invoice-erp')` ≠ V2؛ المجهول → classic؛ لا alias.
- `document-output-template.test.ts`: تجميد erp يبقى تاريخياً، تجميد erp-v2 يبقى v2، المسودة تتبع الحي، الملف بلا ذكر `tax-invoice-erp-v2`.
- `document-erp-v2.test.tsx`: 11 — `data-doc-composition="erp_v2"`، عربي/إنجليزي/ثنائي Bidi، 1/5/20 بنداً، بلا شعار احتياطي، QR 64، أقسام اختيارية تنهار.
- `document-modern.test.tsx`: 21 — انحدار ERP التاريخي (3 مناطق، مربع شعار، بلا bilingual) ما زال أخضر؛ Modern V2 لم يُمس.
- `document-legacy-modern.test.tsx`: 6 — Modern التاريخي ثابت.
- `erp-v2.test.ts`: 3 — مجموع نسب الأعمدة **100%**؛ QR 64 < 76؛ شعار 28 < 36.
- `template-styles.test.ts`: توكنز Classic/ERP/Minimal/Retail ثابتة؛ `ERP_V2_STYLE` مستقل عن `MODERN_V2_STYLE`.
- `visual-v2-print.test.ts`: CSS `modern_v2` لم يُمس؛ قواعد `erp_v2` لا تُطبَّق على `erp`.

### PHP

لم يُمسّ backend. **`php artisan test` لم يُشغَّل** — لا هجرات ولا خدمات محاسبية.

### Frontend build

`npm run build` (Next.js 15.5.19) نجح محلياً: Compiled successfully، Lint/types، 144 صفحة ثابتة.

---

## 6. Build / CI

| الأمر | النتيجة |
| --- | --- |
| `php artisan test` | غير مشغَّل (لا backend) |
| `npm run test` | 194 ملفاً / **1176** اختباراً |
| `npm run build` | نجح محلياً (Next.js 15.5.19) |
| GitHub CI | **نجح** 5/5 على `0ef73425b1ac28f8ce541db70745779f487eec6d`؛ لا دمج |

---

## 7. Visual QA المحدود

نُفِّذ عبر Playwright على `/document-qa` محلياً (`http://127.0.0.1:3001`)، **بلا جلسة مستأجر**. لقطات `#qa-print-root` في `/opt/cursor/artifacts/` — أسماء جديدة بلا overwrite. المقاييس في `erp_v2_qa_inspect.json`.

فحص إحداثيات `th`: **صفر تراكب** في الست لقطات. `tableOverflowPx = 0`. عرض الجذر **794px** (A4).

| الملف | السيناريو | المقاييس |
| --- | --- | --- |
| `erp_v2_rtl_ar_five.png` | ERP V2 عربي RTL، 5 بنود | `composition=erp_v2`، طرفان، QR **64**، بلا brand bar، بلا bilingual، ارتفاع 1047 |
| `erp_v2_ltr_en_five.png` | ERP V2 إنجليزي LTR، 5 بنود | عنوان Tax Invoice، وحدة SAR، QR 64، بلا bilingual |
| `erp_v2_bilingual_en_rtl_five.png` | ERP V2 bilingual (locale=en + RTL)، 5 بنود | 29 عقدة ثنائية، بلا ` \| `، SAR، QR 64، ارتفاع 1113 |
| `erp_v2_rtl_ar_twenty.png` | ERP V2 عربي، 20 بنداً | 20 صفاً، ارتفاع 1622، صفر overflow |
| `erp_v2_legacy_erp_rtl_ar_five.png` | انحدار `tax-invoice-erp` | `composition=erp`، 3 مناطق، شريط هوية، QR **110**، بلا `data-doc-keep`، عملة ﷼ التاريخية |
| `erp_v2_regression_modern_v2_bilingual_five.png` | انحدار `tax-invoice-modern-v2` | `composition=modern_v2`، QR **76**، 29 عقدة ثنائية، ارتفاع 1292 (أفسح من ERP V2) |

ما ظهر في ERP V2:

- رأس منطقتين بحدود سوداء؛ الاسم أقوى من الشعار المسقوف؛ بلا مربع احتياطي عند الغياب (الشعار الظاهر صورة الـ fixture).
- طرفان بحدود سوداء؛ الميتا في الرأس لا عمود ثالث.
- الجدول بطل الصفحة؛ الوصف الأوسع؛ الخلايا رقم فقط والوحدة في الرأس (`ريال` / `SAR`).
- إجماليات دفترية بشريط جانبي أسود وقاعدة مزدوجة على الإجمالي النهائي — بلا بطاقة Dashboard وبلا شريط `--doc-brand`.
- QR 64px بإطار أسود قرب الملخص (`data-doc-keep=summary`).
- تذييل contact-only بهواتف.

ما لم يُنفَّذ:

- نقر طباعة/PDF من شاشة فاتورة مستأجر حقيقي.
- مجموعة Playwright e2e الكاملة (`document-qa.spec.ts` ما زالت تستخدم `tax-invoice-erp` كـ legacy عمداً).

---

## 8. Freeze / Assignment

العقد كما هو بعد #616: تجميد = UUID مراجعة + `template_id` نصي داخل JSON التعريف. لا إعادة كتابة بيانات.

| الحالة | السلوك |
| --- | --- |
| مسودة + تعيين حي `tax-invoice-erp` | شكل تاريخي |
| مسودة + تعيين حي `tax-invoice-erp-v2` | ERP V2 |
| مرحّل مجمّد على `tax-invoice-erp` + حي V2 | يبقى تاريخياً |
| مرحّل مجمّد على `tax-invoice-erp-v2` + حي تاريخي | يبقى V2 |
| معرّف مجهول | `getTemplate` → classic |
| Print / PDF | كلا المعرّفين A4 في `listTemplates`؛ PDF يسقط إلى print عند غياب تعيين pdf كما كان |
| Thermal | بلا تغيير؛ القائمة البيضاء `thermal58`/`thermal80` فقط |
| Backend | لم يُمس. `PrintTemplateContract` لا يبيّض معرّفات A4؛ لا migration |

---

## 9. المخاطر والعمل المتبقي

- التخطيط الافتراضي للفاتورة الضريبية ما زال يخفي الملاحظات/البنك/الختم حتى يفعّلها تصميم القالب — قد يظن المراجع أن الأقسام «لا تعمل» على `/document-qa` بنوع `tax_invoice`.
- عشرة أعمدة افتراضية على A4 تبقى كثيفة؛ نسب ERP تخصّص 30% للوصف وتضيّق المالية. تخصيص الأعمدة من المصمّم يبقى صمام الأمان.
- ثنائي اللغة يعتمد locale الواجهة × اتجاه المستند؛ لا حقل API `bilingual`. العرض الثنائي عقدتان معزولتان لا سلسلة `|`.
- Classic/Minimal/Retail/Thermal لم يُعاد تصميمها (خارج النطاق).
- التحقق اليدوي على فاتورة مرحّلة بمستأجر تجريبي ما زال مفيداً قبل الدمج: تعيين حي `tax-invoice-erp` يجب أن يظهر تاريخياً؛ اختيار V2 يتم من الكتالوج صراحةً.

---

## 10. الفرع

`cursor/invoice-visual-v2-erp-7cc0` — مُفرَّع من أحدث `origin/main` بعد دمج #616. لا عمل على فرع Modern.

---

## 11. PR

[#618](https://github.com/safwan5001-source/Nebrax/pull/618) — Draft. **لا Merge ولا Deploy.**

---

## 12. Base SHA

`0f167e7e16150eff186ed4c50affe21d8218d727`  
Merge PR #616: Invoice Visual V2 — Modern V2 منفصل عن الشكل التاريخي.

---

## 13. Implementation SHA vs Head

- **Implementation SHA (كود الهويات والأقسام والاختبارات):** `37c0ed43d3691268f7384b90f6ad8322d92c4c19`
- **CI-green SHA:** `0ef73425b1ac28f8ce541db70745779f487eec6d` (تقرير التنفيذ؛ 5/5)
- **Head SHA:** التزام تسجيل نجاح CI (توثيق لاحق؛ لا التزام لمجرد مزامنة الهاش داخل الملف).

---

## 14. الخطوة التالية

مراجعة [#618](https://github.com/safwan5001-source/Nebrax/pull/618) بصرياً على:

- `/document-qa?template=tax-invoice-erp` → الشكل التاريخي
- `/document-qa?template=tax-invoice-erp-v2` → ERP V2 الكثيف

لم يُدمَج ولم يُنشَر من هذا الوكيل. لا migration لاحقة لهذا الفصل.

---

## Compatibility

| المحور | النتيجة |
| --- | --- |
| ERP التاريخي | فروع `erp` حرفية؛ توكنز `ERP_STYLE` ثابتة |
| Modern legacy / V2 | توكنزهما ثابتة؛ CSS `modern_v2` لم يُمس |
| Classic / Minimal / Retail / Thermal | لم تُغيَّر |
| عقد التصدير | `#print-root` / `#pdf-print-root` كما في #611–#616 |
| تخطيط الكتل المحفوظ | أعمدة قابلة للضبط ما زالت تُحترم |
| الاتجاه | `model.direction` + `resolveDirection`؛ ثنائي اللغة عند اختلاف locale عن الاتجاه |
| المحاسبة / ZATCA / ICV | **لا تغيير** |

---

## Visual Decisions

| القرار | السبب |
| --- | --- |
| هوية سجل جديدة لا in-place | التجميد يخزّن `template_id` نصياً؛ تعديل `erp` كان سيعيد تفسير المرحّل |
| دفتر يومي لا Modern بلون آخر | Modern متّسع (`p-8`/`mt-4`/QR 76)؛ ERP كثيف (`p-5`/`mt-3`/حدود سوداء/QR 64) |
| نسب أعمدة ERP مستقلة | الوصف 30% والمالية أضيق؛ لا نسخ `VISUAL_V2` |
| بلا مربع شعار ملوّن | الاسم القانوني أقوى؛ الغياب = اسم فقط |
| سقف شعار 28px وQR 64px | أصغر من التاريخي وModern حتى لا يهيمن |
| ميتا المستند في الرأس | ليس شبكة Modern الهوائية ولا عمود ERP الثالث |
| إجماليات بقاعدة مزدوجة سوداء | دفتر لا بطاقة Dashboard ولا شريط `--doc-brand` |
| قواعد `thead` تحت `[data-doc-composition=erp_v2]` | لا تُطبَّق على التاريخي ولا تُغيَّر `modern_v2` |
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

ERP التاريخي (شكل) · Classic · Minimal · Retail · Thermal · ZATCA generation · accounting · API/DB schema · إعادة كتابة التعيينات/المراجعات · migrations · second renderer · Merge · Deploy.

(تسميات V2 تُطبَّق إن اختير `tax-invoice-erp-v2`؛ الهوية التاريخية `tax-invoice-erp` لا تحمل bilingual/Bidi.)

---

## ملحق: الأثر المحاسبي

لا قيد. هذا تغيير عرض لقالب الطباعة فقط.

| العملية | مدين | دائن |
| --- | --- | --- |
| عرض/طباعة/PDF فاتورة ERP / ERP V2 | — | — |
