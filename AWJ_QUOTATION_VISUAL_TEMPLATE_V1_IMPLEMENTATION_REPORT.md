# تقرير تنفيذ Quotation Visual Template V1 — قالب عرض سعر إنتاجي مستقل

**المشروع:** نبراس / أَوْج ERP  
**المستودع:** `safwan5001-source/Nebrax`  
**التاريخ:** 2026-09-03  
**القاعدة:** هوية بصرية مستقلة لعرض السعر داخل Document Engine الحالي. لا مسار عارض ثانٍ، لا alias إلى الفاتورة، لا migration، لا إعادة كتابة تعيينات/مراجعات، لا محاسبة/ZATCA/schema، لا دمج، لا نشر.

---

## 1. ما تم

أُضيف قالب **Quotation Proposal** بهوية سجل مستقلة ليبدو مستند قرار مهنياً (Professional Proposal / Sales Document): حشو `p-9` وفواصل `mt-5`، رأس منطقتين بلا مربع شعار ملوّن وبلا شريط هوية، طرفان نصيّان بلا بطاقة-لكل-حقل وبلا عمود ميتا ثالث، جدول بنود `table-fixed` بوصف 33%، إجماليات typography-only بقاعدة على الإجمالي النهائي بلا بطاقة ملوّنة، **بلا ZATCA QR**. التوكنز في `quotation-proposal.ts` مستقلة عن كل عائلات الفاتورة التاريخية وV2.

**عقد الهويات (مانع للدمج إن كُسر):** التجميد يخزّن UUID مراجعة + JSON فيه `template_id` نصي، **لا** يجمّد مكوّن React. لذلك لا يكفي تعديل قالب فاتورة قائم.

| الهوية | التركيب | الشكل |
| --- | --- | --- |
| `tax-invoice-classic` (وباقي الفاتورة) | كما هو | **لم يُمس** — المسار التاريخي والـ V2 كما هما |
| `quotation-proposal` | `quotation_proposal` | Professional Proposal + Bidi + بلا QR |

لا alias من أي `tax-invoice-*` → `quotation-proposal`. `DEFAULT_TEMPLATE_ID` يبقى `tax-invoice-classic` (وهو أيضاً سقوط المجهول). المسودة تتبع التعيين الحي؛ الصادر يتبع `template_id` المجمّد (#612). فروع `quotation_proposal` أُضيفت **قبل** الـ fallback؛ الـ fallback نفسه لم يُلمس.

العارض بقي كما هو: `QuoteDocument` → `DocumentView` → `DocumentBody` → `#print-root` / `#pdf-print-root`. لم يُمسّ `document-output-template.ts` دلالياً.

---

## 2. template_id / nameKey / document type

| الحقل | القيمة |
| --- | --- |
| `template_id` | `quotation-proposal` |
| `nameKey` | `quotation_proposal` |
| i18n | «عرض سعر مهني» / «Professional Proposal» |
| `composition` | `quotation_proposal` |
| `document_type` | `quotation` فقط (`documentTypes: ['quotation']`) |
| الورق | `a4`, `a4_landscape`, `letter`, `legal` (عقد `PAGE_PAPERS`) |
| الثيم الافتراضي | `blue` |

---

## 3. الملفات المتغيرة

| ملف | الدور |
| --- | --- |
| `web/src/modules/documents/presentation/quotation-proposal.ts` | توكنز: شعار 38px، وصف 33%، نسب 4/7/7/14/33/6/8/7/7/7 = **100%**، بلا `qrSizePx` |
| `web/src/modules/documents/presentation/quotation-proposal.test.ts` | حارس الكثافة والنسب ومقاس الشعار دون نسخ الفاتورة |
| `web/src/modules/documents/templates/quotation-proposal.tsx` | يغلف `DocumentBody` ويفرض `qr: false` |
| `web/src/modules/documents/templates/template-styles.ts` | `QUOTATION_PROPOSAL_STYLE` + `isQuotationProposal` |
| `web/src/modules/documents/registry/templates.ts` | سجل الهوية + `listTemplatesForDocumentType` |
| `web/src/modules/documents/types/index.ts` | `'quotation_proposal'` + `documentTypes?` على الواصف |
| `web/src/app/globals.css` | قواعد طباعة مقيّدة بـ `quotation_proposal` |
| `web/src/app/document-qa/page.tsx` | خيار `quotation-proposal` |
| `web/src/messages/ar.json` / `en.json` | `invoiceTemplates.quotation_proposal` |
| أقسام `doc-header` … `doc-voucher` | فروع `quotation_proposal` جديدة فقط قبل الـ fallback |
| الاستوديو ومنتقيات الفاتورة/التصاميم/المشتريات/السندات | تصفية الكتالوج حسب `document_type` |
| `document-quotation-proposal.test.tsx` وحرّاس التجميد/التعريف الحي/CSS | اختبارات |

لم يُمسّ: `document-output-template.ts`، قوالب الفاتورة التاريخية وV2 والحراري، PHP، الهجرات، ZATCA generation، تقارير Invoice Visual V2.

---

## 4. الاختبارات ونتائجها

### Vitest — `npm run test` في `web/`

```
Test Files  202 passed (202)
Tests       1266 passed (1266)
Duration    21.80s
```

منها:

- `templates.test.ts`: تسجيل `quotation-proposal` بلا alias؛ المجهول → classic؛ الكتالوج حسب النوع يُظهره لـ `quotation` فقط لا `tax_invoice` ولا الحراري.
- `document-output-template.test.ts`: صادر مجمّد على classic لا يتبع تعيين `quotation-proposal` الحي؛ صادر مجمّد على `quotation-proposal` لا يرجع إلى classic؛ المسودة تتبع الحي؛ الملف بلا ذكر `quotation-proposal`.
- `live-template-definition.test.ts`: هوية `quotation-proposal` تُحفظ لنوع `quotation`.
- `document-quotation-proposal.test.tsx`: 15 — تركيب مستقل، بلا QR حتى مع حقن، بلا شعار احتياطي، طرفان، 1/5/20/`long_content`، أعمدة قابلة للضبط، ضريبة تُطوى عند الصفر، Bidi، انحدار Classic/Retail/V2.
- `quotation-proposal.test.ts`: مجموع نسب **100%**؛ وصف 33% أوسع من ERP 30%؛ شعار 38 مستقل؛ بلا `qrSizePx`.
- `visual-v2-print.test.ts`: قواعد CSS للفاتورة لم تُمس؛ قواعد `quotation_proposal` معزولة.

### PHP

لم يُمسّ backend. **`php artisan test` لم يُشغَّل.**

---

## 5. Build / CI

| الأمر | النتيجة |
| --- | --- |
| `php artisan test` | غير مشغَّل (لا backend) |
| `npm run test` | 202 ملفاً / **1266** اختباراً |
| `npm run build` | نجح محلياً (Next.js 15.5.19) Compiled successfully + Lint/types |
| GitHub CI | **نجح** 5/5 على `92ce6a2e124df0c32ee69e4fa6aac5c98ca03632` في [#625](https://github.com/safwan5001-source/Nebrax/pull/625): sqlite ×2، pgsql ×2، Web CI. لا دمج |

---

## 6. Visual QA

نُفِّذ عبر Playwright على `/document-qa` محلياً (`http://127.0.0.1:3001`)، **بلا جلسة مستأجر**. لقطات `#qa-print-root` في `/opt/cursor/artifacts/`. المقاييس في `quotation_proposal_qa_inspect.json`.

فحص إحداثيات `th`: **صفر تراكب** في كل اللقطات. `tableOverflowPx = 0`. عرض الجذر **794px** (A4). التذييل ظاهر. `headerTableOverlap = false`.

| الملف | السيناريو | المقاييس |
| --- | --- | --- |
| `quotation_proposal_rtl_ar_five.png` | عربي RTL، 5 بنود | `composition=quotation_proposal`، بلا QR، بلا brand bar، ارتفاع 1627 |
| `quotation_proposal_ltr_en_five.png` | إنجليزي LTR، 5 بنود | عنوان Quotation، بلا QR، ارتفاع 1716 |
| `quotation_proposal_bilingual_en_rtl_five.png` | bilingual (locale=en + RTL) | 29 عقدة ثنائية، بلا QR، ارتفاع 1835 |
| `quotation_proposal_rtl_ar_twenty.png` | عربي، 20 بنداً | 20 صفاً، ارتفاع 2686، صفر overflow |
| `quotation_proposal_rtl_ar_single_nologo.png` | بند واحد بلا شعار/أصول | بلا مربع احتياطي، بلا QR |
| `quotation_proposal_rtl_ar_long.png` | محتوى طويل | ملاحظات/شروط طويلة بلا قص أفقي |
| `regression_classic_rtl_ar_five.png` | انحدار Classic | `composition=classic`، 3 بطاقات، شريط هوية، QR |
| `regression_classic_v2_rtl_ar_five.png` | انحدار Classic V2 | QR في الملخص |
| `regression_retail_v2_rtl_ar_five.png` | انحدار Retail V2 | QR + باركود مستند |

ما لم يُنفَّذ:

- نقر طباعة/PDF من شاشة عرض سعر مستأجر حقيقي (`/quotes/[id]`).
- مجموعة Playwright e2e الكاملة (`document-qa.spec.ts`) — لم تُحوَّل عمداً.

---

## 7. كيفية الحفاظ على #612 live/frozen semantics

- المحوّل `resolveDocumentOutputTemplates` **لم يُعدَّل**.
- المسودة (`print_issued_at == null`) تحل تعيين `quotation` الحي؛ إن عُيّن `quotation-proposal` يُرسم به.
- الصادر يقرأ `template_id` من لقطة المراجعة فقط. إعادة تعيين الحي إلى `quotation-proposal` لا تغيّر عرضاً مجمّداً على `tax-invoice-classic`.
- اختبارات صريحة لذلك في `document-output-template.test.ts`.
- `getTemplate` للمجهول يبقى classic — عروض بلا تعيين لا تتغيّر.

---

## 8. Backward Compatibility

- لا alias من/إلى هويات الفاتورة.
- لا تعديل `template_id` تاريخي.
- لا rewrite لتعيينات أو revisions.
- قوالب الفاتورة تبقى متاحة لتعيينات `quotation` القائمة (غياب `documentTypes` = كل الأنواع).
- `quotation-proposal` لا يظهر في منتقي الفاتورة ولا التصاميم ولا الحراري.
- Invoice Legacy / V2 / Thermal 58/80 كما هي في الاختبارات واللقطات.

---

## 9. بيان عدم تغيير Accounting / ZATCA / API / DB / Tenant Isolation

- **Accounting:** لا. لا `LedgerService` ولا قيود.
- **ZATCA:** لا. القالب يفرض `qr: false` وفرع الملخص لا يرسم QR. `ZatcaService` لم يُمس.
- **API / DB / migrations:** لا.
- **Tenant Isolation:** الحل الحي عبر `/print-templates/resolve` القائم. لا تجاوز scope.

المبالغ تُعرض من `DocumentModel` فقط؛ لا إعادة حساب subtotal/tax/discount/total.

---

## 10. المخاطر والمتبقي

- عيّنة QA تحمل `shipping`/`adjustment` لأنها في `DocumentModel` العام؛ محوّل `from-quote.ts` لا يمرّرهما، فلن يظهرا على عرض سعر حقيقي ما لم يُضف المصدر لاحقاً.
- لم تُختبر طباعة/PDF من `/quotes/[id]` بجلسة مستأجر.
- Thermal UI لعروض الأسعار ما زال خارج النطاق كما في #612.
- الخطوة التالية بعد المراجعة: قوالب بصرية لأنواع أخرى عند الطلب، أو ربط تعيين افتراضي اختياري لـ `quotation-proposal` — **ليس في هذا PR**.

---

## 11. Branch

`cursor/quotation-visual-template-v1-cbf9`

---

## 12. PR URL/number

https://github.com/safwan5001-source/Nebrax/pull/625  
**#625**

---

## 13. Base SHA

`1ee45aceaafe76b7e1ecc6531dd560deb8c00409` (`origin/main` عند التفريع؛ دمج PR #623 Retail V2)

---

## 14. Head SHA

كود القالب: `42bb675bf36942582108ae1e42626072ec658d23`  
Head الذي أخضر عليه CI: `92ce6a2e124df0c32ee69e4fa6aac5c98ca03632`

---

## 15. الخطوة التالية

انتظار مراجعة صفوان. **لا Merge. لا Deploy.**
