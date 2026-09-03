# تقرير تنفيذ Invoice Visual V2 — Retail V2 بهوية مستقلة

**المشروع:** نبراس / أَوْج ERP  
**المستودع:** `safwan5001-source/Nebrax`  
**التاريخ:** 2026-09-03  
**القاعدة:** فصل هوية `tax-invoice-retail` التاريخية عن تصميم Retail V2 التجاري سريع المسح عبر سجل مستقل (`tax-invoice-retail-v2` / `retail_v2`). لا migration، لا إعادة كتابة تعيينات/مراجعات، لا محاسبة/ZATCA/schema، لا محرّك عارض ثانٍ، لا دمج، لا نشر. **لا يكتب فوق تقارير Modern وERP وClassic وMinimal.**

---

## 1. Executive Summary

أُضيف قالب **Retail V2** بهوية سجل مستقلة ليبدو مستنداً تجارياً يفوز بسرعة المسح والمنتج أولاً: حشو `p-6` وفواصل `mt-3` (أضيق من Classic V2 وأوسع من ERP V2، وأهدأ من التاريخي `brand`/`brandBar`)، جدول `table-fixed` بـ 11px وقواعد شعرية `--border`، رأس منطقتين بلا مربع شعار ملوّن، طرفان نصيّان بلا إطار وبلا بطاقة ميتا ثالثة، إجماليات typography-only بقاعدة `border-t-2 --border` على الإجمالي النهائي، وQR **66px** قرب الملخص، وباركود مستند Code128 كما في التاريخي. التوكنز في `retail-v2.ts` مستقلة عن Modern/ERP/Classic/Minimal V2 وعن `RETAIL_STYLE` التاريخي.

**عقد الهويات (مانع للدمج إن كُسر):** التجميد يخزّن UUID مراجعة + JSON فيه `template_id` نصي، **لا** يجمّد مكوّن React. لذلك لا يكفي تعديل الـ fallback المشترك. Retail التاريخي **ليست له فروع `composition === 'retail'`**؛ يسقط مع Classic التاريخي إلى نفس الـ fallback:

| الهوية | التركيب | الشكل |
| --- | --- | --- |
| `tax-invoice-retail` | `retail` | **كما هو** — ثلاث بطاقات `grid-cols-3`، شريط `--doc-brand` `h-1`، حبة رقم رمادية، رأس جدول brand، QR **110px**، بطاقة إجماليات `rounded-lg border-gray-200`، باركود مستند |
| `tax-invoice-retail-v2` | `retail_v2` | Commercial / Product-first / Fast-scanning + Bidi + باركود مستند |

لا alias من `tax-invoice-retail` → V2. `DEFAULT_TEMPLATE_ID` يبقى `tax-invoice-classic` (وهو أيضاً سقوط المجهول). المسودة تتبع التعيين الحي؛ المرحّل يتبع `template_id` المجمّد. فروع `retail_v2` أُضيفت **قبل** الـ fallback المشترك؛ الـ fallback نفسه لم يُلمس حرفياً. لم يُوسَّع `isRedesignedComposition` (`erp`/`modern`/`minimal` فقط). لا `startsWith('retail')`.

العارض بقي كما هو: `InvoiceDocument` → `DocumentView` → `DocumentBody` → `#print-root` / `#pdf-print-root`. لم يُمسّ `document-output-template.ts` دلالياً.

إعادة استخدام آمنة من #616/#618/#619/#621 فقط: `useDocumentLabelMode`، `ModernBilingualLabel`، كتالوج التسميات/العملة (`ريال` / `SAR` / bilingual `SAR`). **لا** نسخ نسب `VISUAL_V2` ولا `ERP_V2` ولا `CLASSIC_V2` ولا `MINIMAL_V2`.

---

## 2. ما تم

| المحور | النتيجة |
| --- | --- |
| أنواع | `'retail_v2'` في `TemplateComposition` |
| أسلوب | `RETAIL_STYLE` كما هو. `RETAIL_V2_STYLE` جديد: `p-6` / `mt-3` / `compact` / `rounded-none` / `tableHead: plain` / `brandBar: false` |
| مكوّن | `tax-invoice-retail.tsx` يبقى على `RETAIL_STYLE` + `barcode: true`. ملف جديد `tax-invoice-retail-v2.tsx` يغلف `DocumentBody` بـ `RETAIL_V2_STYLE` ويفرض `barcode: true` |
| سجل | `tax-invoice-retail-v2` / `nameKey: retail_v2` / ثيم افتراضي `blue`. الورق كالتاريخي: `['a4', 'letter']` |
| i18n | `invoiceTemplates.retail_v2` = «تجزئة V2» / «Retail V2». `/document-qa` يعرض **كلا** `tax-invoice-retail` و`tax-invoice-retail-v2` بثيم `blue`، ويظهر باركود المستند لهما فقط |
| أقسام | فروع **جديدة** `retail_v2` فقط في header/parties/items/summary/totals/notes/terms/bank/footer/qr/signature/stamp (وvoucher/amount-words للتسميات) **قبل** الـ fallback |
| طباعة | قواعد `thead`/`break-inside` تحت `[data-doc-composition="retail_v2"]` — لا تُطبَّق على `retail` ولا تُغيَّر قواعد عائلات V2 السابقة |
| تجميد | بلا تعديل دلالي لـ `document-output-template.ts` (حارس مصدر: الملف بلا ذكر `tax-invoice-retail-v2`) |

---

## 3. كيف حُفظ Retail التاريخي

- **لا يوجد فرع `composition === 'retail'`** في الأقسام. التاريخي يسقط مع Classic إلى نفس الـ fallback: ثلاث بطاقات، شريط هوية، حبة رقم، QR 110، بطاقة إجماليات رمادية.
- الـ fallback نفسه لم يُلمس حرفياً — أي تعديل عليه كان سيصيب Classic التاريخي وRetail التاريخي معاً.
- مربع الشعار الملوّن `.h-14` ما زال عبر `isRedesignedComposition` (`erp`/`modern`/`minimal` فقط — **لم يُضف** `retail` ولا `retail_v2`). Retail التاريخي يستخدم `rounded-xl` من مسار غير المعاد تصميمه.
- QR الافتراضي لغير V2 يبقى **110px**.
- اختبار الانحدار في `document-retail-v2.test.tsx`: `composition=retail`، ثلاث بطاقات، شريط `h-1`، QR 110، باركود مستند، بلا `data-modern-bilingual`. Classic التاريخي على نفس الـ fallback: ثلاث بطاقات + `h-1` + QR 110.
- توكنز `RETAIL_STYLE` محروسة في `template-styles.test.ts` (`p-6` / `mt-4` / `rounded-md` / `tableHead: brand` / `brandBar: true`). `RETAIL_V2_STYLE.pagePadding` يساوي التاريخي عمداً؛ التمايز في `sectionGap`/`tableHead`/`brandBar`.
- `e2e/document-qa.spec.ts` لم يُحوَّل.

التعيينات الحية الحالية على `tax-invoice-retail` ترجع تلقائياً للشكل القديم لأن العارض يحلّ المعرّف كما هو. V2 خيار كتالوج جديد فقط.

---

## 4. الملفات

| ملف | الدور |
| --- | --- |
| `web/src/modules/documents/presentation/retail-v2.ts` | توكنز Retail V2: شعار 30px، QR 66px، نسب أعمدة 3/8/**10**/16/**28**/6/7/7/6/9 = **100%** |
| `web/src/modules/documents/presentation/retail-v2.test.ts` | حارس الكثافة والنسب ومقاسات الشعار/QR دون نسخ Modern/ERP/Classic/Minimal |
| `web/src/modules/documents/templates/template-styles.ts` | `RETAIL_V2_STYLE` + مساعدَا `isRetailV2` / `isLegacyRetail` |
| `web/src/modules/documents/templates/tax-invoice-retail-v2.tsx` | هوية V2 الجديدة مع `barcode: true` |
| `web/src/modules/documents/registry/templates.ts` | سجل الهويتين؛ بلا alias؛ الافتراضي classic |
| `web/src/modules/documents/types/index.ts` | `'retail_v2'` في الاتحاد |
| `web/src/app/globals.css` | قواعد طباعة مقيّدة بـ `retail_v2` (إضافةً إلى عائلات V2 السابقة دون تغييرها) |
| `web/src/app/document-qa/page.tsx` | خيارا `tax-invoice-retail` و`tax-invoice-retail-v2` بثيم `blue`؛ باركود ظاهر لهما فقط |
| `web/src/messages/ar.json` / `en.json` | `invoiceTemplates.retail_v2` |
| أقسام `doc-header` … `doc-voucher` | فروع `retail_v2` جديدة فقط قبل الـ fallback |
| `document-retail-v2.test.tsx` | تركيب V2 + Bidi + 1/5/20/`long_content` + انحدار Retail/Classic/Modern V2/ERP V2/Classic V2/Minimal V2 |
| `templates.test.ts` / `document-output-template.test.ts` / `live-template-definition.test.ts` / `visual-v2-print.test.ts` | سجل، تجميد، تعريف حي، عزل CSS |

لم يُمسّ: `document-output-template.ts`، `tax-invoice-retail.tsx`، قوالب Modern/ERP/Classic/Minimal/Thermal، PHP، الهجرات، ZATCA generation، تقارير `AWJ_INVOICE_VISUAL_V2_MODERN_IMPLEMENTATION_REPORT.md` و`AWJ_INVOICE_VISUAL_V2_ERP_IMPLEMENTATION_REPORT.md` و`AWJ_INVOICE_VISUAL_V2_CLASSIC_IMPLEMENTATION_REPORT.md` و`AWJ_INVOICE_VISUAL_V2_MINIMAL_IMPLEMENTATION_REPORT.md`.

---

## 5. الاختبارات

### Vitest — `npm run test` في `web/`

```
Test Files  200 passed (200)
Tests       1240 passed (1240)
Duration    21.47s
```

منها:

- `templates.test.ts`: `getTemplate('tax-invoice-retail')` ≠ V2؛ المجهول → classic؛ لا alias؛ `DEFAULT_TEMPLATE_ID` ثابت.
- `document-output-template.test.ts`: تجميد retail يبقى تاريخياً حتى لو الحي V2، تجميد retail-v2 يبقى v2 حتى لو الحي تاريخي، المسودة تتبع الحي، الملف بلا ذكر `tax-invoice-retail-v2`. اختبارات freeze القائمة التي تستخدم قوالب أخرى **لم تُغيَّر**.
- `document-retail-v2.test.tsx`: 12 — `data-doc-composition="retail_v2"`، عربي/إنجليزي/ثنائي Bidi، 1/5/20/`long_content`، بلا شعار احتياطي، QR 66، باركود مستند، طرفان بلا بطاقة ميتا وبلا بطاقة إجماليات رمادية.
- انحدار Retail التاريخي: ثلاث بطاقات، شريط `h-1`، QR 110، باركود مستند، بلا `data-modern-bilingual`.
- انحدار Classic التاريخي على نفس الـ fallback: ثلاث بطاقات + `h-1` + QR 110.
- انحدار Modern V2 QR **76** وERP V2 QR **64** وClassic V2 QR **70** وMinimal V2 QR **60** داخل الملف نفسه.
- `retail-v2.test.ts`: 3 — مجموع نسب الأعمدة **100%**؛ وصف 28% بين Classic 26% وERP 30%؛ باركود 10% أوضح من 7–8% في العائلات الأخرى؛ QR 66 بين ERP 64 وClassic 70؛ شعار 30 بين ERP 28 وClassic 32.
- `template-styles.test.ts`: توكنز Classic/ERP/Modern/Minimal/Retail ثابتة؛ `RETAIL_V2_STYLE` مستقل (`p-6` = التاريخي عمداً؛ `sectionGap`/`tableHead`/`brandBar` تختلف).
- `visual-v2-print.test.ts`: CSS `modern_v2`/`erp_v2`/`classic_v2`/`minimal_v2` لم يُمس؛ قواعد `retail_v2` لا تُطبَّق على `retail`.

### PHP

لم يُمسّ backend. **`php artisan test` لم يُشغَّل** — لا هجرات ولا خدمات محاسبية.

### Frontend build

`npm run build` (Next.js 15.5.19) نجح محلياً: Compiled successfully، Lint/types.

---

## 6. Build / CI

| الأمر | النتيجة |
| --- | --- |
| `php artisan test` | غير مشغَّل (لا backend) |
| `npm run test` | 200 ملفاً / **1240** اختباراً |
| `npm run build` | نجح محلياً (Next.js 15.5.19) |
| GitHub CI | **نجح** 5/5 على `e5a9eafe67f6f8b39fa52bd3199302fd29d1e3d7`؛ لا دمج |

---

## 7. Visual QA المحدود

نُفِّذ عبر Playwright على `/document-qa` محلياً (`http://127.0.0.1:3001`)، **بلا جلسة مستأجر**. لقطات `#qa-print-root` في `/opt/cursor/artifacts/` — أسماء جديدة بلا overwrite. المقاييس في `retail_v2_qa_inspect.json`.

فحص إحداثيات `th`: **صفر تراكب** في اللقطات العشر. `tableOverflowPx = 0`. عرض الجذر **794px** (A4). التذييل ظاهر غير مقصوص (`footerClippedPx = 0`؛ هواتف + سطر العينة). باركود المستند مرسوم على Retail وRetail V2 فقط.

| الملف | السيناريو | المقاييس |
| --- | --- | --- |
| `retail_v2_rtl_ar_five.png` | Retail V2 عربي RTL، 5 بنود | `composition=retail_v2`، طرفان، بلا بطاقة ميتا، بلا شريط هوية، QR **66**، باركود مستند، بلا bilingual، ارتفاع 1059 |
| `retail_v2_ltr_en_five.png` | Retail V2 إنجليزي LTR، 5 بنود | عنوان Tax Invoice، وحدة SAR، QR 66، باركود مستند، بلا bilingual، ارتفاع 1135 |
| `retail_v2_bilingual_en_rtl_five.png` | Retail V2 bilingual (locale=en + RTL)، 5 بنود | 29 عقدة ثنائية، بلا ` \| `، QR 66، باركود مستند، ارتفاع 1292 |
| `retail_v2_rtl_ar_twenty.png` | Retail V2 عربي، 20 بنداً | 20 صفاً، ارتفاع 1957، صفر overflow، تذييل ظاهر |
| `retail_v2_rtl_ar_long_content.png` | Retail V2 عربي، وصف/ملاحظات طويلة | 5 صفوف، ارتفاع 1077، صفر overflow، وصف يلتف |
| `retail_v2_legacy_retail_rtl_ar_five.png` | انحدار `tax-invoice-retail` | `composition=retail`، 3 بطاقات، شريط `h-1`، QR **110**، باركود مستند، بلا `data-doc-keep` |
| `retail_v2_regression_modern_v2_bilingual_five.png` | انحدار `tax-invoice-modern-v2` | `composition=modern_v2`، QR **76**، 29 عقدة ثنائية، بلا باركود مستند، ارتفاع 1292 |
| `retail_v2_regression_erp_v2_rtl_ar_five.png` | انحدار `tax-invoice-erp-v2` | `composition=erp_v2`، QR **64**، بلا باركود مستند، ارتفاع 1047 |
| `retail_v2_regression_classic_v2_rtl_ar_five.png` | انحدار `tax-invoice-classic-v2` | `composition=classic_v2`، QR **70**، بلا باركود مستند، ارتفاع 1072 |
| `retail_v2_regression_minimal_v2_rtl_ar_five.png` | انحدار `tax-invoice-minimal-v2` | `composition=minimal_v2`، QR **60**، بلا باركود مستند، ارتفاع 1461 |

ما ظهر في Retail V2:

- رأس منطقتين بفاصل `--border`؛ الاسم أقوى من الشعار المسقوف 30px؛ بلا مربع احتياطي عند الغياب (Vitest: `header .h-14` غائب).
- طرفان بلا إطار وبلا بطاقة ميتا ثالثة؛ الحقول الاختيارية تنهار.
- الجدول بطل الصفحة؛ الباركود **10%** أوضح؛ الوصف **28%** بين Classic وERP؛ الخلايا رقم فقط والوحدة في الرأس (`ريال` / `SAR`).
- إجماليات typography-only + قاعدة `border-t-2 --border` على الإجمالي النهائي `text-[14px] font-bold` — بلا بطاقة زرقاء وبلا شريط جانبي أسود وبلا فاصل `--doc-brand`.
- QR 66px بإطار `--border` قرب الملخص (`data-doc-keep=summary`).
- باركود مستند Code128 لرقم المستند — علامة التجزئة؛ `DocBarcode` نفسه لم يُعدَّل.
- تذييل contact-only بهواتف.

ما لم يُنفَّذ:

- نقر طباعة/PDF من شاشة فاتورة مستأجر حقيقي.
- مجموعة Playwright e2e الكاملة (`document-qa.spec.ts`).

---

## 8. Freeze / Assignment

العقد كما هو بعد #616/#618/#619/#621: تجميد = UUID مراجعة + `template_id` نصي داخل JSON التعريف. لا إعادة كتابة بيانات.

| الحالة | السلوك |
| --- | --- |
| مسودة + تعيين حي `tax-invoice-retail` | شكل تاريخي (ثلاث بطاقات + شريط هوية + QR 110 + باركود مستند) |
| مسودة + تعيين حي `tax-invoice-retail-v2` | Retail V2 |
| مرحّل مجمّد على `tax-invoice-retail` + حي V2 | يبقى تاريخياً |
| مرحّل مجمّد على `tax-invoice-retail-v2` + حي تاريخي | يبقى V2 |
| معرّف مجهول | `getTemplate` → classic |
| Print / PDF | كلا المعرّفين A4 في `listTemplates`؛ PDF يسقط إلى print عند غياب تعيين pdf كما كان |
| Thermal | بلا تغيير؛ القائمة البيضاء `thermal58`/`thermal80` فقط |
| Backend | لم يُمس. `PrintTemplateContract` لا يبيّض معرّفات A4؛ لا migration |

---

## 9. المخاطر والعمل المتبقي

- التخطيط الافتراضي للفاتورة الضريبية ما زال يخفي الملاحظات/البنك/الختم حتى يفعّلها تصميم القالب — قد يظن المراجع أن الأقسام «لا تعمل» على `/document-qa` بنوع `tax_invoice`.
- `LINE_ITEM_DEFAULT` يخفي قسم باركود المستند؛ غلاف Retail/Retail V2 يفرض `sections.barcode: true`، وصفحة `/document-qa` تُظهر القسم لهما فقط عندما يوجد `layout`. عمود باركود البنود منفصل ويأتي من أعمدة النوع الافتراضية.
- عشرة أعمدة افتراضية على A4 تبقى كثيفة؛ نسب Retail تخصّص 10% للباركود و28% للوصف. تخصيص الأعمدة من المصمّم يبقى صمام الأمان.
- ثنائي اللغة يعتمد locale الواجهة × اتجاه المستند؛ لا حقل API `bilingual`. العرض الثنائي عقدتان معزولتان لا سلسلة `|`.
- خطر خاص بالـ fallback المشترك: أي تعديل لاحق على مسار Classic/Retail التاريخي يصيب الهويتين معاً. فروع `retail_v2` تبقى صريحة ومستقلة. لا `startsWith('retail')`.
- التحقق اليدوي على فاتورة مرحّلة بمستأجر تجريبي ما زال مفيداً قبل الدمج: تعيين حي `tax-invoice-retail` يجب أن يظهر تاريخياً؛ اختيار V2 يتم من الكتالوج صراحةً.

---

## 10. الفرع

`cursor/invoice-visual-v2-retail-7cc0` — مُفرَّع من أحدث `origin/main` بعد دمج #621. لا عمل على فروع Modern/ERP/Classic/Minimal.

---

## 11. PR

[#623](https://github.com/safwan5001-source/Nebrax/pull/623) — Draft. **لا Merge ولا Deploy.**

---

## 12. Base SHA

`ed67907e6d9f1dc05999ab20362a3ddb02da47f2`  
Merge PR #621: Invoice Visual V2 Minimal V2.

---

## 13. Implementation SHA vs Head

- **Implementation SHA (كود الهويات والأقسام والاختبارات):** `07b085b00f70ad514157d805ced2ba2565a14319`
- **CI-green SHA:** `e5a9eafe67f6f8b39fa52bd3199302fd29d1e3d7` (تقرير التنفيذ؛ 5/5)
- **Head SHA:** التزام تسجيل نجاح CI (توثيق لاحق؛ لا التزام لمجرد مزامنة الهاش داخل الملف).

---

## 14. الخطوة التالية

مراجعة [#623](https://github.com/safwan5001-source/Nebrax/pull/623) بصرياً على:

- `/document-qa?template=tax-invoice-retail` → الشكل التاريخي (ثلاث بطاقات + شريط هوية + QR 110 + باركود مستند)
- `/document-qa?template=tax-invoice-retail-v2` → Retail V2 (مسح سريع + QR 66 + باركود مستند)

لم يُدمَج ولم يُنشَر من هذا الوكيل. لا migration لاحقة لهذا الفصل.

---

## Compatibility

| المحور | النتيجة |
| --- | --- |
| Retail التاريخي | يسقط إلى الـ fallback المشترك مع Classic؛ توكنز `RETAIL_STYLE` ثابتة؛ `isRedesignedComposition` لم يُوسَّع |
| Classic التاريخي | نفس الـ fallback لم يُلمس؛ ثلاث بطاقات + شريط هوية + QR 110 |
| Modern legacy / V2 | توكنزهما ثابتة؛ CSS `modern_v2` لم يُمس؛ QR 76 |
| ERP legacy / V2 | توكنزهما ثابتة؛ CSS `erp_v2` لم يُمس؛ QR 64 |
| Classic V2 | توكنزها ثابتة؛ CSS `classic_v2` لم يُمس؛ QR 70 |
| Minimal legacy / V2 | توكنزهما ثابتة؛ CSS `minimal_v2` لم يُمس؛ QR 60 |
| Thermal | لم تُغيَّر |
| عقد التصدير | `#print-root` / `#pdf-print-root` كما في #611–#621 |
| تخطيط الكتل المحفوظ | أعمدة قابلة للضبط ما زالت تُحترم |
| الاتجاه | `model.direction` + `resolveDirection`؛ ثنائي اللغة عند اختلاف locale عن الاتجاه |
| المحاسبة / ZATCA / ICV | **لا تغيير** |

---

## Visual Decisions

| القرار | السبب |
| --- | --- |
| هوية سجل جديدة لا in-place | التجميد يخزّن `template_id` نصياً؛ تعديل الـ fallback كان سيعيد تفسير المرحّل Classic وRetail معاً |
| مسح سريع ومنتج أولاً لا V2 أخرى بلون أهدأ | Classic متوسط (`p-7`/QR 70)؛ ERP كثيف (`p-5`/QR 64)؛ Minimal أفسح (`p-10`/QR 60)؛ Retail V2 تجاري (`p-6`/QR 66) |
| نسب أعمدة Retail مستقلة | باركود 10% أوضح؛ وصف 28% بين Classic 26% وERP 30%؛ لا نسخ التوكنز الأخرى |
| بلا مربع شعار ملوّن | الاسم القانوني أقوى؛ الغياب = اسم فقط. `isRedesignedComposition` يبقى على erp/modern/minimal |
| سقف شعار 30px وQR 66px | بين ERP 28/64 وClassic 32/70 |
| طرفان بلا إطار وبلا بطاقة ميتا | الميتا في الرأس؛ التاريخي يحتفظ بثلاث بطاقات `grid-cols-3` |
| إجماليات typography-only + `border-t-2` | الإجمالي النهائي أقوى عنصر مالي للمسح؛ لا بطاقة زرقاء ولا شريط أسود |
| باركود المستند في الغلاف | علامة التجزئة كالتاريخي؛ `DocBarcode` لم يُعدَّل |
| قواعد `thead` تحت `[data-doc-composition=retail_v2]` | لا تُطبَّق على التاريخي ولا تُغيَّر عائلات V2 الأخرى |
| اتجاه منطقي `start`/`end` | لا `left`/`right` في توكنز الشعار |
| ثيم كتالوج `blue` | كالتاريخي؛ ليس gray/black |
| الورق `a4`/`letter` فقط | كالتاريخي؛ ليس legal |

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

Retail التاريخي (شكل + fallback مشترك مع Classic) · Modern · ERP · Classic · Minimal · Thermal · ZATCA generation · accounting · API/DB schema · إعادة كتابة التعيينات/المراجعات · migrations · second renderer · توسيع `isRedesignedComposition` · Merge · Deploy.

(تسميات V2 تُطبَّق إن اختير `tax-invoice-retail-v2`؛ الهوية التاريخية `tax-invoice-retail` لا تحمل bilingual/Bidi.)

---

## ملحق: الأثر المحاسبي

لا قيد. هذا تغيير عرض لقالب الطباعة فقط.

| العملية | مدين | دائن |
| --- | --- | --- |
| عرض/طباعة/PDF فاتورة Retail / Retail V2 | — | — |
