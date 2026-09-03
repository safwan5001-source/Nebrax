# تقرير تنفيذ Invoice Visual V2 — Minimal V2 بهوية مستقلة

**المشروع:** نبراس / أَوْج ERP  
**المستودع:** `safwan5001-source/Nebrax`  
**التاريخ:** 2026-09-03  
**القاعدة:** فصل هوية `tax-invoice-minimal` التاريخية عن تصميم Minimal V2 القائم على البياض والطبعة عبر سجل مستقل (`tax-invoice-minimal-v2` / `minimal_v2`). لا migration، لا إعادة كتابة تعيينات/مراجعات، لا محاسبة/ZATCA/schema، لا محرّك عارض ثانٍ، لا دمج، لا نشر. **لا يكتب فوق تقارير Modern وERP وClassic.**

---

## 1. Executive Summary

أُضيف قالب **Minimal V2** بهوية سجل مستقلة ليبدو مستنداً هادئاً يفوز بالبياض والطبعة لا بالحدود ولا بلون الهوية: حشو `p-10` وفواصل `mt-6` (أفسح من Modern/Classic/ERP وأهدأ من التاريخي `p-12`/`mt-8`)، جدول `table-fixed` بـ 11px وقواعد شعرية `--border`، رأس منطقتين بلا مربع شعار ملوّن، طرفان نصيّان بلا إطار وبلا صف ميتا ثالث، إجماليات typography-only بقاعدة شعرية واحدة، وQR **60px** قرب الملخص. التوكنز في `minimal-v2.ts` مستقلة عن Modern/ERP/Classic V2 وعن `MINIMAL_STYLE` التاريخي.

**عقد الهويات (مانع للدمج إن كُسر):** التجميد يخزّن UUID مراجعة + JSON فيه `template_id` نصي، **لا** يجمّد مكوّن React. لذلك لا يكفي تعديل `composition === 'minimal'` in-place — وفروع `minimal` في الرأس/الأطراف/الملخص **حصرية** (ليست مشتركة مع Retail):

| الهوية | التركيب | الشكل |
| --- | --- | --- |
| `tax-invoice-minimal` | `minimal` | **كما هو** — مربع شعار ملوّن `.h-14` عند الغياب، طرفان + صف ميتا `col-span-2`، جدول بلا `table-fixed` وشريط أسود على عمود الإجمالي (`td.border-s-2`)، QR **110px**، بلا bilingual |
| `tax-invoice-minimal-v2` | `minimal_v2` | Typography / Whitespace / Rules first + Bidi |

لا alias من `tax-invoice-minimal` → V2. `DEFAULT_TEMPLATE_ID` يبقى `tax-invoice-classic` (وهو أيضاً سقوط المجهول). المسودة تتبع التعيين الحي؛ المرحّل يتبع `template_id` المجمّد. فروع `minimal_v2` أُضيفت **قبل** فروع `minimal` الحصرية؛ فروع `minimal` نفسها لم تُلمس. لم يُوسَّع `isRedesignedComposition` ولا `isMinimal`.

العارض بقي كما هو: `InvoiceDocument` → `DocumentView` → `DocumentBody` → `#print-root` / `#pdf-print-root`. لم يُمسّ `document-output-template.ts` دلالياً.

إعادة استخدام آمنة من #616/#618/#619 فقط: `useDocumentLabelMode`، `ModernBilingualLabel`، كتالوج التسميات/العملة (`ريال` / `SAR` / bilingual `SAR`). **لا** نسخ نسب `VISUAL_V2` ولا `ERP_V2` ولا `CLASSIC_V2`.

---

## 2. ما تم

| المحور | النتيجة |
| --- | --- |
| أنواع | `'minimal_v2'` في `TemplateComposition` |
| أسلوب | `MINIMAL_STYLE` كما هو. `MINIMAL_V2_STYLE` جديد: `p-10` / `mt-6` / `spacious` / `rounded-none` / `tableHead: plain` / `brandBar: false` |
| مكوّن | `tax-invoice-minimal.tsx` يبقى على `MINIMAL_STYLE`. ملف جديد `tax-invoice-minimal-v2.tsx` يغلف `DocumentBody` بـ `MINIMAL_V2_STYLE` |
| سجل | `tax-invoice-minimal-v2` / `nameKey: minimal_v2` / ثيم افتراضي `black`. الكتالوج والاستوديو يقرآن `listTemplates()` |
| i18n | `invoiceTemplates.minimal_v2` = «مبسّط V2» / «Minimal V2». `/document-qa` يعرض **كلا** `tax-invoice-minimal` و`tax-invoice-minimal-v2` بثيم `black` |
| أقسام | فروع **جديدة** `minimal_v2` فقط في header/parties/items/summary/totals/notes/terms/bank/footer/qr/signature/stamp (وvoucher/amount-words للتسميات) |
| طباعة | قواعد `thead`/`break-inside` تحت `[data-doc-composition="minimal_v2"]` — لا تُطبَّق على `minimal` ولا تُغيَّر قواعد `modern_v2`/`erp_v2`/`classic_v2` |
| تجميد | بلا تعديل دلالي لـ `document-output-template.ts` (حارس مصدر: الملف بلا ذكر `tax-invoice-minimal-v2`) |

---

## 3. كيف حُفظ Minimal التاريخي

- فروع `if (style.composition === 'minimal')` في الرأس/الأطراف/الملخص بقيت حرفياً. فروع `minimal_v2` تسبقها ولا تعدّلها.
- مربع الشعار الملوّن `.h-14` ما زال عبر `isRedesignedComposition` (`erp`/`modern`/`minimal` فقط — **لم يُضف** `minimal_v2`).
- صف الميتا `col-span-2` وشريط `td.border-s-2` على عمود الإجمالي و`isMinimal === composition === 'minimal'` ما زالت على التاريخي فقط.
- QR الافتراضي لغير V2 يبقى **110px**.
- اختبار الانحدار في `document-minimal-v2.test.tsx`: `composition=minimal`، مربع `.h-14`، صف ميتا `col-span-2`، شريط عمود الإجمالي، QR 110، بلا `data-modern-bilingual`.
- توكنز `MINIMAL_STYLE` محروسة في `template-styles.test.ts` (`p-12` / `mt-8` / `rounded-none` / `tableHead: plain` / `brandBar: false`).
- `e2e/document-qa.spec.ts` ما زال يثبت `tax-invoice-minimal` كـ legacy عمداً.

التعيينات الحية الحالية على `tax-invoice-minimal` ترجع تلقائياً للشكل القديم لأن العارض يحلّ المعرّف كما هو. V2 خيار كتالوج جديد فقط.

---

## 4. الملفات

| ملف | الدور |
| --- | --- |
| `web/src/modules/documents/presentation/minimal-v2.ts` | توكنز Minimal V2: شعار 34px، QR 60px، نسب أعمدة 3/7/7/14/**32**/5/7/8/7/10 = **100%** |
| `web/src/modules/documents/presentation/minimal-v2.test.ts` | حارس الكثافة والنسب ومقاسات الشعار/QR دون نسخ Modern/ERP/Classic |
| `web/src/modules/documents/templates/template-styles.ts` | `MINIMAL_V2_STYLE` + مساعدَا `isMinimalV2` / `isLegacyMinimal` |
| `web/src/modules/documents/templates/tax-invoice-minimal-v2.tsx` | هوية V2 الجديدة |
| `web/src/modules/documents/registry/templates.ts` | سجل الهويتين؛ بلا alias؛ الافتراضي classic |
| `web/src/modules/documents/types/index.ts` | `'minimal_v2'` في الاتحاد |
| `web/src/app/globals.css` | قواعد طباعة مقيّدة بـ `minimal_v2` (إضافةً إلى `modern_v2`/`erp_v2`/`classic_v2` دون تغييرها) |
| `web/src/app/document-qa/page.tsx` | خيارا `tax-invoice-minimal` و`tax-invoice-minimal-v2` بثيم `black` |
| `web/src/messages/ar.json` / `en.json` | `invoiceTemplates.minimal_v2` |
| أقسام `doc-header` … `doc-voucher` | فروع `minimal_v2` جديدة فقط |
| `document-minimal-v2.test.tsx` | تركيب V2 + Bidi + 1/5/20/`long_content` + انحدار Minimal/Modern V2/ERP V2/Classic V2 |
| `templates.test.ts` / `document-output-template.test.ts` / `live-template-definition.test.ts` / `visual-v2-print.test.ts` | سجل، تجميد، تعريف حي، عزل CSS |

لم يُمسّ: `document-output-template.ts`، `tax-invoice-minimal.tsx`، قوالب Modern/ERP/Classic/Retail/Thermal، PHP، الهجرات، ZATCA generation، تقارير `AWJ_INVOICE_VISUAL_V2_MODERN_IMPLEMENTATION_REPORT.md` و`AWJ_INVOICE_VISUAL_V2_ERP_IMPLEMENTATION_REPORT.md` و`AWJ_INVOICE_VISUAL_V2_CLASSIC_IMPLEMENTATION_REPORT.md`.

---

## 5. الاختبارات

### Vitest — `npm run test` في `web/`

```
Test Files  198 passed (198)
Tests       1218 passed (1218)
Duration    20.90s
```

منها:

- `templates.test.ts`: `getTemplate('tax-invoice-minimal')` ≠ V2؛ المجهول → classic؛ لا alias؛ `DEFAULT_TEMPLATE_ID` ثابت.
- `document-output-template.test.ts`: تجميد minimal يبقى تاريخياً حتى لو الحي V2، تجميد minimal-v2 يبقى v2 حتى لو الحي تاريخي، المسودة تتبع الحي، الملف بلا ذكر `tax-invoice-minimal-v2`. اختبارات freeze القائمة التي تستخدم `tax-invoice-minimal` كـ PDF fallback **لم تُغيَّر**.
- `document-minimal-v2.test.tsx`: 11 — `data-doc-composition="minimal_v2"`، عربي/إنجليزي/ثنائي Bidi، 1/5/20/`long_content`، بلا شعار احتياطي، QR 60، أقسام اختيارية تنهار، طرفان بلا صف ميتا وبلا `border-s-2`.
- انحدار Minimal التاريخي: مربع `.h-14`، صف ميتا `col-span-2`، شريط عمود الإجمالي، QR 110، بلا `data-modern-bilingual`.
- انحدار Modern V2 QR **76** وERP V2 QR **64** وClassic V2 QR **70** داخل الملف نفسه.
- `minimal-v2.test.ts`: 3 — مجموع نسب الأعمدة **100%**؛ وصف 32% أوسع من ERP 30% / Classic 26% / Modern 21%؛ QR 60 أصغر من ERP 64؛ شعار 34 بين Classic 32 وModern 36.
- `template-styles.test.ts`: توكنز Classic/ERP/Modern/Minimal/Retail ثابتة؛ `MINIMAL_V2_STYLE` مستقل (`p-10` ≠ `p-12`/`p-8`/`p-7`/`p-5`).
- `visual-v2-print.test.ts`: CSS `modern_v2`/`erp_v2`/`classic_v2` لم يُمس؛ قواعد `minimal_v2` لا تُطبَّق على `minimal`.

### PHP

لم يُمسّ backend. **`php artisan test` لم يُشغَّل** — لا هجرات ولا خدمات محاسبية.

### Frontend build

`npm run build` (Next.js 15.5.19) نجح محلياً: Compiled successfully، Lint/types.

---

## 6. Build / CI

| الأمر | النتيجة |
| --- | --- |
| `php artisan test` | غير مشغَّل (لا backend) |
| `npm run test` | 198 ملفاً / **1218** اختباراً |
| `npm run build` | نجح محلياً (Next.js 15.5.19) |
| GitHub CI | قيد التشغيل على [#621](https://github.com/safwan5001-source/Nebrax/pull/621) بعد دفع التنفيذ؛ يُحدَّث عند الاكتمال |

---

## 7. Visual QA المحدود

نُفِّذ عبر Playwright على `/document-qa` محلياً (`http://127.0.0.1:3001`)، **بلا جلسة مستأجر**. لقطات `#qa-print-root` في `/opt/cursor/artifacts/` — أسماء جديدة بلا overwrite. المقاييس في `minimal_v2_qa_inspect.json`.

فحص إحداثيات `th`: **صفر تراكب** في التسع لقطات. `tableOverflowPx = 0`. عرض الجذر **794px** (A4). التذييل ظاهر غير مقصوص (`footerClippedPx = 0`؛ هواتف + سطر العينة).

| الملف | السيناريو | المقاييس |
| --- | --- | --- |
| `minimal_v2_rtl_ar_five.png` | Minimal V2 عربي RTL، 5 بنود | `composition=minimal_v2`، طرفان، بلا صف ميتا، بلا شريط عمود، QR **60**، بلا bilingual، ارتفاع 1461 |
| `minimal_v2_ltr_en_five.png` | Minimal V2 إنجليزي LTR، 5 بنود | عنوان Tax Invoice، وحدة SAR، QR 60، بلا bilingual، ارتفاع 1640 |
| `minimal_v2_bilingual_en_rtl_five.png` | Minimal V2 bilingual (locale=en + RTL)، 5 بنود | 29 عقدة ثنائية، بلا ` \| `، QR 60، ارتفاع 1702 |
| `minimal_v2_rtl_ar_twenty.png` | Minimal V2 عربي، 20 بنداً | 20 صفاً، ارتفاع 3176، صفر overflow، تذييل ظاهر |
| `minimal_v2_rtl_ar_long_content.png` | Minimal V2 عربي، وصف/ملاحظات طويلة | 5 صفوف، ارتفاع 1484، صفر overflow، وصف يلتف |
| `minimal_v2_legacy_minimal_rtl_ar_five.png` | انحدار `tax-invoice-minimal` | `composition=minimal`، 3 خلايا أطراف (صف ميتا)، شريط عمود الإجمالي، QR **110**، بلا `data-doc-keep` |
| `minimal_v2_regression_modern_v2_bilingual_five.png` | انحدار `tax-invoice-modern-v2` | `composition=modern_v2`، QR **76**، 29 عقدة ثنائية، ارتفاع 1292 |
| `minimal_v2_regression_erp_v2_rtl_ar_five.png` | انحدار `tax-invoice-erp-v2` | `composition=erp_v2`، QR **64**، ارتفاع 1047 |
| `minimal_v2_regression_classic_v2_rtl_ar_five.png` | انحدار `tax-invoice-classic-v2` | `composition=classic_v2`، QR **70**، ارتفاع 1072 |

ما ظهر في Minimal V2:

- رأس منطقتين بفاصل `--border`؛ الاسم أقوى من الشعار المسقوف 34px؛ بلا مربع احتياطي عند الغياب (Vitest: `header .h-14` غائب).
- طرفان بلا إطار وبلا صف ميتا ثالث؛ الحقول الاختيارية تنهار.
- الجدول بطل الصفحة؛ الوصف **32%** (الأوسع بين عائلات V2)؛ الخلايا رقم فقط والوحدة في الرأس (`ريال` / `SAR`).
- إجماليات typography-only + قاعدة شعرية `--border` على الإجمالي النهائي — بلا بطاقة زرقاء وبلا شريط جانبي أسود وبلا فاصل `--doc-brand`.
- QR 60px بإطار `--border` قرب الملخص (`data-doc-keep=summary`).
- تذييل contact-only بهواتف.

ما لم يُنفَّذ:

- نقر طباعة/PDF من شاشة فاتورة مستأجر حقيقي.
- مجموعة Playwright e2e الكاملة (`document-qa.spec.ts`).

---

## 8. Freeze / Assignment

العقد كما هو بعد #616/#618/#619: تجميد = UUID مراجعة + `template_id` نصي داخل JSON التعريف. لا إعادة كتابة بيانات.

| الحالة | السلوك |
| --- | --- |
| مسودة + تعيين حي `tax-invoice-minimal` | شكل تاريخي (مربع شعار + صف ميتا + شريط عمود + QR 110) |
| مسودة + تعيين حي `tax-invoice-minimal-v2` | Minimal V2 |
| مرحّل مجمّد على `tax-invoice-minimal` + حي V2 | يبقى تاريخياً |
| مرحّل مجمّد على `tax-invoice-minimal-v2` + حي تاريخي | يبقى V2 |
| معرّف مجهول | `getTemplate` → classic |
| Print / PDF | كلا المعرّفين A4 في `listTemplates`؛ PDF يسقط إلى print عند غياب تعيين pdf كما كان |
| Thermal | بلا تغيير؛ القائمة البيضاء `thermal58`/`thermal80` فقط |
| Backend | لم يُمس. `PrintTemplateContract` لا يبيّض معرّفات A4؛ لا migration |

---

## 9. المخاطر والعمل المتبقي

- التخطيط الافتراضي للفاتورة الضريبية ما زال يخفي الملاحظات/البنك/الختم حتى يفعّلها تصميم القالب — قد يظن المراجع أن الأقسام «لا تعمل» على `/document-qa` بنوع `tax_invoice`.
- عشرة أعمدة افتراضية على A4 تبقى كثيفة؛ نسب Minimal تخصّص 32% للوصف. تخصيص الأعمدة من المصمّم يبقى صمام الأمان.
- ثنائي اللغة يعتمد locale الواجهة × اتجاه المستند؛ لا حقل API `bilingual`. العرض الثنائي عقدتان معزولتان لا سلسلة `|`.
- خطر خاص بـ `isMinimal` و`isRedesignedComposition`: أي `startsWith('minimal')` لاحق سيكسر التاريخي أو يلوّث V2 بشريط عمود الإجمالي/مربع الشعار. فروع `minimal_v2` تبقى صريحة ومستقلة.
- التحقق اليدوي على فاتورة مرحّلة بمستأجر تجريبي ما زال مفيداً قبل الدمج: تعيين حي `tax-invoice-minimal` يجب أن يظهر تاريخياً؛ اختيار V2 يتم من الكتالوج صراحةً.

---

## 10. الفرع

`cursor/invoice-visual-v2-minimal-7cc0` — مُفرَّع من أحدث `origin/main` بعد دمج #619. لا عمل على فروع Modern/ERP/Classic.

---

## 11. PR

[#621](https://github.com/safwan5001-source/Nebrax/pull/621) — Draft. **لا Merge ولا Deploy.**

---

## 12. Base SHA

`57c48ddcd1fcc2aaa6023dc9947822bf450a74c0`  
Merge PR #619: Invoice Visual V2 Classic V2.

---

## 13. Implementation SHA vs Head

- **Implementation SHA (كود الهويات والأقسام والاختبارات):** `323603bc968e6e51313ca83bd64f3eef4aacda98`
- **CI-green SHA:** يُسجَّل بعد نجاح GitHub CI (توثيق لاحق؛ لا التزام لمجرد مزامنة الهاش داخل الملف).
- **Head SHA:** التزام هذا التقرير بعد التنفيذ.

---

## 14. الخطوة التالية

مراجعة [#621](https://github.com/safwan5001-source/Nebrax/pull/621) بصرياً على:

- `/document-qa?template=tax-invoice-minimal` → الشكل التاريخي (مربع شعار + صف ميتا + شريط عمود + QR 110)
- `/document-qa?template=tax-invoice-minimal-v2` → Minimal V2 (بياض وطبعة + QR 60)

لم يُدمَج ولم يُنشَر من هذا الوكيل. لا migration لاحقة لهذا الفصل.

---

## Compatibility

| المحور | النتيجة |
| --- | --- |
| Minimal التاريخي | فروع `minimal` حرفية؛ توكنز `MINIMAL_STYLE` ثابتة؛ `isRedesignedComposition`/`isMinimal` لم تُوسَّع |
| Modern legacy / V2 | توكنزهما ثابتة؛ CSS `modern_v2` لم يُمس؛ QR 76 |
| ERP legacy / V2 | توكنزهما ثابتة؛ CSS `erp_v2` لم يُمس؛ QR 64 |
| Classic legacy / V2 | توكنزهما ثابتة؛ CSS `classic_v2` لم يُمس؛ QR 70 |
| Retail / Thermal | لم تُغيَّر |
| عقد التصدير | `#print-root` / `#pdf-print-root` كما في #611–#619 |
| تخطيط الكتل المحفوظ | أعمدة قابلة للضبط ما زالت تُحترم |
| الاتجاه | `model.direction` + `resolveDirection`؛ ثنائي اللغة عند اختلاف locale عن الاتجاه |
| المحاسبة / ZATCA / ICV | **لا تغيير** |

---

## Visual Decisions

| القرار | السبب |
| --- | --- |
| هوية سجل جديدة لا in-place | التجميد يخزّن `template_id` نصياً؛ تعديل `minimal` كان سيعيد تفسير المرحّل |
| بياض وطبعة لا Modern/ERP/Classic بلون أهدأ | Modern متّسع (`p-8`/QR 76)؛ Classic متوسط (`p-7`/QR 70)؛ ERP كثيف (`p-5`/QR 64)؛ Minimal V2 أفسح وأهدأ (`p-10`/QR 60) |
| نسب أعمدة Minimal مستقلة | الوصف 32% أوسع من ERP 30% / Classic 26% / Modern 21%؛ لا نسخ التوكنز الأخرى |
| بلا مربع شعار ملوّن | الاسم القانوني أقوى؛ الغياب = اسم فقط. `isRedesignedComposition` يبقى على التاريخي |
| سقف شعار 34px وQR 60px | QR الأهدأ بين عائلات V2؛ الشعار بين Classic 32 وModern 36 |
| طرفان بلا إطار وبلا صف ميتا | الميتا في الرأس؛ التاريخي يحتفظ بصف `col-span-2` |
| إجماليات typography-only | لا بطاقة زرقاء ولا شريط أسود ولا فاصل `--doc-brand` |
| قواعد `thead` تحت `[data-doc-composition=minimal_v2]` | لا تُطبَّق على التاريخي ولا تُغيَّر عائلات V2 الأخرى |
| اتجاه منطقي `start`/`end` | لا `left`/`right` في توكنز الشعار |
| ثيم كتالوج `black` | كالتاريخي؛ ليس blue/gray |

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

Minimal التاريخي (شكل) · Modern · ERP · Classic · Retail · Thermal · ZATCA generation · accounting · API/DB schema · إعادة كتابة التعيينات/المراجعات · migrations · second renderer · Merge · Deploy.

(تسميات V2 تُطبَّق إن اختير `tax-invoice-minimal-v2`؛ الهوية التاريخية `tax-invoice-minimal` لا تحمل bilingual/Bidi.)

---

## ملحق: الأثر المحاسبي

لا قيد. هذا تغيير عرض لقالب الطباعة فقط.

| العملية | مدين | دائن |
| --- | --- | --- |
| عرض/طباعة/PDF فاتورة Minimal / Minimal V2 | — | — |
