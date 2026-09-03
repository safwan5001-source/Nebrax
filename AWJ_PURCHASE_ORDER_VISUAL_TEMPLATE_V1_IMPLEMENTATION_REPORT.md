# تقرير تنفيذ Purchase Order Visual Template V1 — قالب أمر شراء إنتاجي مستقل

**المشروع:** نبراس / أَوْج ERP  
**المستودع:** `safwan5001-source/Nebrax`  
**التاريخ:** 2026-09-03  
**القاعدة:** هوية بصرية مستقلة لأمر الشراء داخل Document Engine الحالي. لا مسار عارض ثانٍ، لا alias إلى الفاتورة أو عرض السعر، لا migration، لا إعادة كتابة تعيينات/مراجعات، لا محاسبة/ZATCA/schema، لا دمج، لا نشر.

---

## 1. Executive Summary

أُضيف قالب **Formal Purchase Order** بهوية سجل مستقلة ليبدو مستند توريد رسمياً تشغيلياً موجّهاً للمورّد: حشو `p-7` وفواصل `mt-4` وجدول `compact`، رأس منطقتين بلا مربع شعار ملوّن وبلا شريط هوية، طرفان Buyer ↔ Supplier بلا بطاقة-لكل-حقل وبلا عمود ميتا ثالث، جدول بنود `table-fixed` بطلُه المنتج+الوصف ثم رمز الصنف (10%)، إجماليات typography-only بقاعدة على الإجمالي النهائي بلا بطاقة ملوّنة، **بلا ZATCA QR**. التوكنز في `purchase-order-formal.ts` مستقلة عن `quotation-proposal` وعن كل عائلات الفاتورة التاريخية وV2.

**عقد الهويات (مانع للدمج إن كُسر):** التجميد يخزّن UUID مراجعة + JSON فيه `template_id` نصي، **لا** يجمّد مكوّن React. لذلك لا يكفي تعديل قالب فاتورة قائم.

| الهوية | التركيب | الشكل |
| --- | --- | --- |
| `tax-invoice-*` (Legacy + V2 + حراري) | كما هو | **لم يُمس** |
| `quotation-proposal` | `quotation_proposal` | **لم يُمس** |
| `purchase-order-formal` | `purchase_order_formal` | Formal / Operational / Supplier-facing + Bidi + بلا QR |

لا alias من أي `tax-invoice-*` أو `quotation-proposal` → `purchase-order-formal`. `DEFAULT_TEMPLATE_ID` يبقى `tax-invoice-classic`. المسودة تتبع التعيين الحي؛ الصادر يتبع `template_id` المجمّد (#612). فروع `purchase_order_formal` أُضيفت **قبل** الـ fallback؛ الـ fallback نفسه لم يُلمس.

العارض بقي كما هو: `PurchaseOrderDocument` → `DocumentView` → `DocumentBody` → `#purchase-order-print-root` / `#pdf-print-root`. لم يُمسّ `document-output-template.ts` دلالياً ولا `from-purchase-order.ts` ولا PHP.

---

## 2. ما تغيّر

Frontend فقط: هوية سجل جديدة + تركيب أقسام مشتركة + توكنز عرض + i18n + خيار `/document-qa` + اختبارات حراسة. لا تعيين تلقائي، لا هجرة مراجعات قائمة.

---

## 3. template_id

`purchase-order-formal`

---

## 4. nameKey

`purchase_order_formal`  
i18n: «أمر شراء رسمي» / «Formal Purchase Order»

---

## 5. composition

`purchase_order_formal`

`PURCHASE_ORDER_FORMAL_STYLE`: `pagePadding: p-7` · `sectionGap: mt-4` · `tableHead: plain` · `tableDensity: compact` · `cardRadius: rounded-none` · `brandBar: false` · الثيم الافتراضي `gray`.

---

## 6. document_type

`purchase_order` فقط (`documentTypes: ['purchase_order']`).  
الورق: `a4`, `a4_landscape`, `letter`, `legal`.

---

## 7. visual personality

**Procurement / Formal / Operational / Supplier-facing** — مغاير لعرض السعر المهني (`p-9` / comfortable / ثيم أزرق / وصف 33%).

- رأس هادئ: هوية قانونية في البداية المنطقية، رقم وتاريخ أمر الشراء في المقابل. شعار أقصى 31px. بلا بانر/تدرج/مربع شعار ملوّن.
- أطراف عمودين: المشتري ↔ المورّد عبر تسميات `purchase_buyer` / `supplier`. الحقول الاختيارية تنطوي.
- جدول البنود البطل: نسب 4/10/7/16/30/7/8/6/6/6 = **100%**. أرقام ورموز بـ Mono. الوصف يلتف.
- ملخص typography-only؛ صف الضريبة ينطوي عند الصفر. لا اختراع حساب.
- شروط ثم ملاحظات حسب عقد `PURCHASE_ORDER_DEFAULT`. التوقيع اختياري بلا مساحة ميتة. تذييل هادئ.

---

## 8. الملفات المتغيرة

| ملف | الدور |
| --- | --- |
| `web/src/modules/documents/presentation/purchase-order-formal.ts` | توكنز: شعار 31px، نسب مستقلة مجموعها 100%، بلا `qrSizePx` |
| `web/src/modules/documents/presentation/purchase-order-formal.test.ts` | حارس الكثافة والنسب ومقاس الشعار |
| `web/src/modules/documents/templates/purchase-order-formal.tsx` | يغلف `DocumentBody` ويفرض `qr: false` |
| `web/src/modules/documents/templates/template-styles.ts` | `PURCHASE_ORDER_FORMAL_STYLE` + `isPurchaseOrderFormal` |
| `web/src/modules/documents/registry/templates.ts` | سجل الهوية |
| `web/src/modules/documents/types/index.ts` | `'purchase_order_formal'` في `TemplateComposition` |
| `web/src/app/globals.css` | قواعد طباعة مقيّدة بـ `purchase_order_formal` |
| `web/src/app/document-qa/page.tsx` | خيار المعاينة + ثيم gray |
| `web/src/messages/ar.json` / `en.json` | `invoiceTemplates.purchase_order_formal` |
| أقسام `doc-header` … `doc-voucher` | فروع `purchase_order_formal` قبل الـ fallback |
| `document-purchase-order-formal.test.tsx` وحرّاس التجميد/التعريف الحي/CSS/السجل | اختبارات |

لم يُمسّ: `document-output-template.ts`، `from-purchase-order.ts`، `quotation-proposal`، قوالب الفاتورة التاريخية وV2 والحراري، PHP، الهجرات، ZATCA generation.

---

## 9. إعادة استخدام Document Engine

المصدر → `buildPurchaseOrderDocumentModel` → `DocumentModel` → `DocumentView` → المكوّن المسجَّل → `DocumentBody` + الأقسام المشتركة → المصدّر القائم (Print/PDF). لا عارض ثانٍ ولا مسار PDF جديد ولا رسم خادمي.

---

## 10. الحفاظ على دلالات #612 live/frozen

- المحوّل `resolveDocumentOutputTemplates` **لم يُعدَّل**.
- المسودة (`print_issued_at == null`) تحل تعيين `purchase_order` الحي؛ إن عُيّن `purchase-order-formal` يُرسم به.
- الصادر يقرأ `template_id` من لقطة المراجعة فقط. إعادة تعيين الحي إلى `purchase-order-formal` لا تغيّر عرضاً مجمّداً على `tax-invoice-classic`.
- اختبارات صريحة في `document-output-template.test.ts`.
- `getTemplate` للمجهول يبقى classic — أوامر بلا تعيين لا تتغيّر.

---

## 11. مركز القوالب / التعيين

- يظهر لـ `purchase_order` عبر `templateSupportsDocumentType` / `listTemplatesForDocumentType`.
- يدعم تعيين Print وPDF.
- لا يظهر في منتقي فاتورة-فقط ولا عرض-سعر-فقط ولا الحراري.
- قوالب الفاتورة التاريخية بلا `documentTypes` تبقى متاحة لتعيينات أمر الشراء القائمة.
- لا auto-assignment ولا هجرة.

---

## 12. سلوك Print / PDF

لم يتغيّر مسار الإنتاج: `procurement-detail.tsx` يحل المخرجات ثم يرسم `PurchaseOrderDocument` على `#purchase-order-print-root`، و`#pdf-print-root` عند اختلاف تعريف PDF. الجذور والتعيين المنفصل كما في #612.

---

## 13. تأكيد غياب ZATCA QR

- المحوّل الإنتاجي يضع `qr: null`.
- الغلاف يفرض `sections.qr: false`.
- `DocQr` لـ `purchase_order_formal` يعيد `<div />`.
- الملخص بلا فتحة QR.
- اختبار حقن `qr: { value: 'forced-zatca-payload' }` + `sections.qr: true` → لا SVG ولا نص zatca.
- Visual QA: `qrSvg: false` في كل لقطات القالب الجديد. Classic ما زال يرسم QR.

لم يُمسّ `ZatcaService`.

---

## 14. الحسابات المحاسبية دون تغيير

المبالغ تُعرض من `DocumentModel` فقط. لا إعادة حساب `subtotal` / `tax` / `discount` / `total`. صف الضريبة ينطوي عند الصفر. لا `LedgerService` ولا قيود. `from-purchase-order.ts` لم يُعدَّل.

---

## 15. الاختبارات والنتائج

### Vitest — `npm run test` في `web/`

```
Test Files  213 passed (213)
Tests       1331 passed (1331)
Duration    22.45s
```

منها:

- `purchase-order-formal.test.ts`: مجموع نسب **100%**؛ رمز الصنف 10% أوسع من عرض السعر وERP؛ شعار 31 مستقل؛ بلا `qrSizePx`.
- `templates.test.ts`: تسجيل بلا alias؛ الكتالوج لـ `purchase_order` فقط لا `tax_invoice` ولا `quotation` ولا الحراري؛ `DEFAULT_TEMPLATE_ID` يبقى classic.
- `document-output-template.test.ts`: الملف بلا ذكر `purchase-order-formal`؛ صادر مجمّد على classic لا يتبع الحي الجديد؛ صادر مجمّد على الهوية الجديدة لا يرجع إلى classic؛ المسودة تتبع الحي.
- `live-template-definition.test.ts`: الهوية تُحفظ لنوع `purchase_order`.
- `document-purchase-order-formal.test.tsx`: 16 — تركيب مستقل، بلا QR حتى مع حقن، بلا شعار احتياطي، طرفان، 1/5/20/`long_content`، أعمدة قابلة للضبط، ضريبة تُطوى عند الصفر، Bidi، انحدار Classic/Retail/V2/`quotation-proposal`.
- `document-quotation-proposal.test.tsx`: 15 ما زالت خضراء.
- `visual-v2-print.test.ts`: قواعد CSS للفاتورة وعرض السعر لم تُمس؛ قواعد `purchase_order_formal` معزولة.

### PHP

لم يُمسّ backend. **`php artisan test` لم يُشغَّل محلياً.**

---

## 16. Build

`npm run build` نجح محلياً: Next.js 15.5.19 Compiled successfully + Lint/types. `/document-qa` موجود في المخرج.

---

## 17. GitHub CI

**نجح** على `fc0e3fcf852c9f1d97751c2f9a8492e4fd19d943` في [#629](https://github.com/safwan5001-source/Nebrax/pull/629): sqlite، pgsql، Web CI. لا دمج.

| الفحص | الحالة |
| --- | --- |
| php artisan test (L11, sqlite) | نجح (4m1s) |
| php artisan test (L11, pgsql) | نجح (8m56s) |
| web build (Next.js) | نجح (2m0s) |

---

## 18. Visual QA

نُفِّذ عبر Playwright على `/document-qa` محلياً (`http://127.0.0.1:3001`، `next start` بعد البناء)، **بلا جلسة مستأجر**. لقطات `#qa-print-root` في `/opt/cursor/artifacts/`. المقاييس في `purchase_order_formal_qa_inspect.json`.

فحص إحداثيات `th`: **صفر تراكب** في كل اللقطات. `tableOverflowPx = 0`. عرض الجذر **794px** (A4). التذييل ظاهر. `headerTableOverlap = false`.

| الملف | السيناريو | المقاييس |
| --- | --- | --- |
| `purchase_order_formal_rtl_ar_five.png` | عربي RTL، 5 بنود | `composition=purchase_order_formal`، بلا QR، بلا brand bar، ارتفاع 1159 |
| `purchase_order_formal_ltr_en_five.png` | إنجليزي LTR، 5 بنود | عنوان Purchase Order، بلا QR، ارتفاع 1228 |
| `purchase_order_formal_bilingual_en_rtl_five.png` | bilingual (locale=en + RTL) | 28 عقدة ثنائية، بلا QR، ارتفاع 1346 |
| `purchase_order_formal_rtl_ar_twenty.png` | عربي، 20 بنداً | 20 صفاً، ارتفاع 1767، صفر overflow |
| `purchase_order_formal_rtl_ar_long.png` | محتوى طويل | شروط/ملاحظات طويلة بلا قص أفقي |
| `purchase_order_formal_rtl_ar_single_nologo.png` | بند واحد بلا شعار/أصول | بلا مربع احتياطي، بلا QR، بلا توقيع ميت |
| `regression_quotation_proposal_rtl_ar_five.png` | انحدار عرض السعر | `composition=quotation_proposal`، بلا QR |
| `regression_classic_rtl_ar_five.png` | انحدار Classic | `composition=classic`، 3 بطاقات، شريط هوية، QR |

ما لم يُنفَّذ:

- نقر طباعة/PDF من شاشة أمر شراء مستأجر حقيقي (`/purchase-orders/[id]`).
- مجموعة Playwright e2e الكاملة (`document-qa.spec.ts`) — لم تُحوَّل عمداً.

---

## 19. Backward Compatibility

- لا alias من/إلى هويات الفاتورة أو `quotation-proposal`.
- لا تعديل `template_id` تاريخي.
- لا rewrite لتعيينات أو revisions.
- قوالب الفاتورة تبقى متاحة لتعيينات `purchase_order` القائمة.
- `purchase-order-formal` لا يظهر في منتقي الفاتورة ولا عرض السعر ولا الحراري.
- Invoice Legacy / V2 / Thermal 58/80 و`quotation-proposal` كما هي في الاختبارات واللقطات.

---

## 20. Tenant Isolation

الحل الحي عبر `/print-templates/resolve` القائم مع `document_type=purchase_order` و`branch_id`. لا تجاوز `TenantScope`. لا استعلام جديد.

---

## 21. بيان API / DB / migrations

لا تغيير API ولا جداول ولا هجرات. `template_id` النصي يُحفظ داخل `definition` JSON للمراجعة كما هو. لا قائمة بيضاء خلفية لهويات A4.

---

## 22. المخاطر والمتبقي

- عيّنة QA تحمل `shipping`/`adjustment`/`tax` لأنها في `DocumentModel` العام؛ محوّل `from-purchase-order.ts` يمرّر `tax` من المصدر ولا يمرّر خصماً/شحنًا، فلن يظهرا على أمر شراء حقيقي ما لم يُضف المصدر لاحقاً. صف الضريبة يُعرض فقط إذا كانت قيمة النموذج > 0.
- لم تُختبر طباعة/PDF من `/purchase-orders/[id]` بجلسة مستأجر.
- Thermal UI لأوامر الشراء ما زال خارج النطاق كما في #612.
- لا تعيين افتراضي تلقائي للقالب الجديد — أوامر قائمة تبقى على classic ما لم يُعيَّن القالب يدوياً.
- الخطوة التالية بعد المراجعة: قوالب بصرية لأنواع أخرى عند الطلب، أو ربط تعيين اختياري — **ليس في هذا PR**.

---

## 23. Branch

`cursor/purchase-order-visual-template-v1-cdb8`

---

## 24. PR URL/number

https://github.com/safwan5001-source/Nebrax/pull/629  
**#629**

---

## 25. Base SHA

`2ea1ff72c23b44a6b28db105ddf8abc214a0a5cc` (`origin/main` عند التفريع؛ يشمل دمج PR #625 ثم #628 Developer Portal)

---

## 26. Head SHA

كود القالب: `4030c03ba66a0c6bd4e66b7d7a8fc102dc9416dc`  
Head الذي أخضر عليه CI: `fc0e3fcf852c9f1d97751c2f9a8492e4fd19d943`

---

## 27. الخطوة التالية

انتظار مراجعة صفوان. **لا Merge. لا Deploy.**
