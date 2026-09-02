# تقرير تنفيذ Invoice Visual V2 — Foundation + Modern Template

**المشروع:** نبراس / أَوْج ERP  
**المستودع:** `safwan5001-source/Nebrax`  
**التاريخ:** 2026-09-02  
**القاعدة:** أساس بصري V2 + إعادة تصميم قالب `tax-invoice-modern` للفاتورة فقط — معاينة/طباعة/PDF، عربي/إنجليزي/ثنائي. لا ERP/Classic/Minimal/Retail، لا عروض/أوامر شراء/إشعارات/فواتير مشتريات/سندات، لا محاسبة/ZATCA/schema، لا محرّك عارض ثانٍ، لا دمج، لا نشر.

---

## Executive Summary

أُعيد تصميم قالب **Modern** (`tax-invoice-modern`) ليبدو مستنداً مالياً رسمياً بدل بطاقة واجهة: رأس بهويتين (منشأة | مستند)، طرفان بلا بطاقات، جدول بنود `table-fixed` بطل الصفحة، إجماليات بفاصل هوية رفيع، وQR أصغر قرب الملخص. الأساس في `visual-v2.ts` توكنز عرض محلية لا تُحفظ في المراجعة.

العارض بقي كما هو: `InvoiceDocument` → `DocumentView` → `DocumentBody` → `#print-root` / `#pdf-print-root`. لم يُمسّ `document-output-template.ts`. الحقول الاختيارية (`status`، `due_date`، `discount`، `shipping`، `adjustment`) تُمرَّر من بيانات الفاتورة القائمة للعرض فقط — **بلا إعادة حساب**.

---

## Audit Findings

**Base branch:** `main`  
**Base SHA عند التفريع:** `36525584b4545ef511c839b04ce3bc7f2535aa2e`  
(دمج PR #614؛ `git fetch origin main` ثم التفريع إلى `cursor/invoice-visual-v2-modern-7cc0`.)

### المحرك القائم (لم يُستبدل)

| الطبقة | الملف | العقد |
| --- | --- | --- |
| العارض | `web/src/modules/documents/components/document-view.tsx` | قالب مسجَّل + ثيم + `formatMoney` |
| التركيب | `document-body.tsx` | أقسام مشتركة عبر `composition` |
| الغلاف | `doc-layout.tsx` | `#print-root`، 210mm، ثيم `--doc-brand*` |
| القالب | `tax-invoice-modern.tsx` | يغلف `DocumentBody` بـ `MODERN_STYLE` |
| التصدير | `documentExporter` | لم يُمس |

### فجوات Modern قبل هذا PR (من الكود)

- رأس بلا VAT/CR/عنوان/استحقاق؛ مربع شعار ملوّن عند الغياب.
- أطراف بثلاث بطاقات ذات حدود؛ ميتا المستند في عمود ثالث.
- رأس جدول `soft` بخلفية `--doc-brand-soft` وتناوب صفوف ملوّن.
- إجماليات داخل بطاقة `rounded-md` بخلفية brand-soft.
- QR 110px داخل `rounded-lg`.
- ملاحظات/بنك/شروط كبطاقات.
- لا CSS لتكرار `thead` أو `break-inside: avoid`.

`DocumentModel` لم يكن يحمل `status` ولا يمرّر `from-invoice` حقول `due_date`/`discount`/`shipping`/`adjustment` رغم وجودها على فاتورة التفاصيل.

### قرار القالب

لم يُنشأ معرّف قالب V2 جديد. أُعيد تصميم `tax-invoice-modern` فقط.

لا blocker محاسبي أو ZATCA أو schema. لا PHP.

---

## Implementation

فروع `style.composition === 'modern'` فقط. ERP / Minimal / Classic / Retail لم تُغيَّر توكنزها (محروس باختبار).

### الرأس

منطقتان: هوية المنشأة (شعار `object-contain` ≤48px، اسم `line-clamp-2`، VAT/CR/عنوان) | هوية المستند (عنوان ثنائي مضغوط، رقم مرة واحدة، تاريخ، استحقاق إن وُجد، نوع الدفع). بلا مربع احتياطي ملوّن عند غياب الشعار. شارة `draft`/`cancelled` فقط — ليس `posted`.

### الأطراف

عمودان بلا بطاقات. البائع في الأطراف: الاسم + الرقم الضريبي (السجل والعنوان في الرأس). المشتري: الاسم + الضريبي + المدينة. الحقول الفارغة تنهار عبر `DocInfoRow`. الهاتف/الجوال في التذييل.

### الجدول

`table-fixed`، نسب الأعمدة العشرة الافتراضية مجموعها **100%** (حارس اختبار)، وصف/منتج `break-words`، أكواد `break-all`، أرقام `num` + `nowrap`. بلا تناوب ملوّن. تكرار `thead` في الطباعة مقيّد بـ `[data-doc-composition="modern"]`.

### الإجماليات وQR والتذييل

إجماليات بلا بطاقة زرقاء؛ إبراز بالوزن وفاصل `--doc-brand` رفيع. QR 88px إن وُجد، قرب الملخص. ملاحظات/بنك/شروط: فاصل + عنوان، تنهار عند الفراغ. التذييل هادئ `mt-auto` مع هاتف/جوال.

### تمرير البيانات (عرض فقط)

`SourceInvoice` يقبل اختيارياً: `status`، `due_date`، `discount`، `shipping`، `adjustment`. التحويل إلى هللات عبر `riyalToMinor` القائم. الصفر يُحذف فلا يظهر سطراً فارغاً. POS والمعاينة بلا هذه الحقول يبقيان كما هما.

---

## Changed Files

| ملف | الدور |
| --- | --- |
| `web/src/modules/documents/presentation/visual-v2.ts` | توكنز V2، تسميات ثنائية، نسب الأعمدة، سقف الشعار/QR |
| `web/src/modules/documents/presentation/use-document-label-mode.ts` | حسم ar/en/bilingual من locale والاتجاه |
| `web/src/modules/documents/presentation/visual-v2.test.ts` | عقد الأساس |
| `web/src/modules/documents/presentation/visual-v2-print.test.ts` | عزل CSS الطباعة عن بقية القوالب |
| `web/src/modules/documents/templates/template-styles.ts` | `MODERN_STYLE`: بلا بطاقات، `tableHead: plain` |
| `web/src/modules/documents/templates/tax-invoice-modern.tsx` | تعليق الهوية الرسمية |
| `web/src/modules/documents/types/index.ts` | `status?` عرضي على النموذج |
| `web/src/modules/documents/builder/from-invoice.ts` | تمرير الحقول الاختيارية القائمة |
| `web/src/modules/documents/components/sections/doc-layout.tsx` | `data-doc-composition` |
| `web/src/modules/documents/components/sections/doc-header.tsx` | رأس Modern |
| `web/src/modules/documents/components/sections/doc-parties.tsx` | عمودان بلا بطاقات |
| `web/src/modules/documents/components/sections/doc-items-table.tsx` | table-fixed + نسب 100% |
| `web/src/modules/documents/components/sections/doc-totals.tsx` | بلا بطاقة brand-soft |
| `web/src/modules/documents/components/sections/doc-qr.tsx` | 88px |
| `web/src/modules/documents/components/sections/doc-summary.tsx` | `data-doc-keep=summary` |
| `web/src/modules/documents/components/sections/doc-notes.tsx` / `doc-terms.tsx` / `doc-bank.tsx` | فاصل بدل بطاقة |
| `web/src/modules/documents/components/sections/doc-footer.tsx` | هاتف/جوال |
| `web/src/modules/documents/components/sections/doc-signature.tsx` | تسمية Modern |
| `web/src/modules/documents/components/sections/doc-info-row.tsx` | محاذاة end اختيارية |
| `web/src/app/globals.css` | قواعد طباعة مقيّدة بـ modern |
| `web/src/modules/documents/components/document-modern.test.tsx` | عرض jsdom لتركيب Modern |
| اختبارات styles / from-invoice / items-table | حراسة عدم كسر القوالب الأخرى |

لم يُمسّ: `document-output-template.ts`، قوالب ERP/Classic/Minimal/Retail، PHP، الهجرات، ZATCA generation.

---

## Visual Decisions

| القرار | السبب |
| --- | --- |
| لا قالب بمعرّف جديد | الافتراض عند غياب جواب: إعادة تصميم `tax-invoice-modern` |
| `cardRadius: rounded-none` و`tableHead: plain` | مستند رسمي لا بطاقة UI |
| بلا مربع شعار ملوّن | يخالف «لا صناديق ملوّنة»؛ الغياب = اسم فقط |
| سقف شعار 48px وQR 88px | لا يهيمنان على الرأس/الملخص |
| ميتا المستند في الرأس لا عمود ثالث | بطاقة لكل حقل تضعف الجدول |
| أطراف عمودين؛ البائع بدون تكرار السجل/العنوان | الهوية القانونية في الرأس؛ الفاتورة إلى للمشتري |
| نسب أعمدة مجموعها 100% | أول لقطة LTR أظهرت تراكب باركود/منتج عندما تجاوز المجموع 100% |
| شارة المسودة/الملغى فقط | المرحّل هو الحالة الطبيعية فلا وسْم |
| قواعد `thead`/`break-inside` تحت `[data-doc-composition=modern]` | لا تُطبَّق على ERP/Minimal |
| اتجاه منطقي `start`/`end` | لا `left`/`right` في توكنز الشعار |

الثيم ما زال عبر `--doc-brand*`؛ لا hex مبعثر في الأقسام.

---

## Compatibility

| المحور | النتيجة |
| --- | --- |
| ERP / Classic / Minimal / Retail | توكنزها ثابتة باختبار `template-styles.test.ts`؛ فروع التركيب لم تُمس |
| عقد التصدير | `#print-root` / `#pdf-print-root` كما في #611–#614 |
| المراجعات المجمّدة | ما زالت تختار `tax-invoice-modern`؛ المظهر الجديد يسري على القالب لا على layout المحفوظ |
| تخطيط الكتل المحفوظ | أعمدة قابلة للضبط ما زالت تُحترم (اختبار label مخصّص) |
| POS / معاينة بلا due_date | حقول اختيارية؛ `optionalSourceMinor` لا يخترع أصفاراً |
| الاتجاه | `model.direction` + `resolveDirection`؛ ثنائي اللغة عند اختلاف locale عن الاتجاه |
| المحاسبة / ZATCA / ICV | **لا تغيير** |

التخطيط الافتراضي لـ `tax_invoice` ما زال يخفي notes/terms/bank/stamp/signature حتى يفعّلها تخطيط القالب المحفوظ — لم يُوسَّع نطاق الظهور الافتراضي عمداً.

---

## Tests

### Vitest — `npm run test` في `web/`

```
Test Files  189 passed (189)
Tests       1122 passed (1122)
Duration    20.22s
```

منها:

- `visual-v2.test.ts`: 16 (وضع التسمية، عدم تكرار القيمة، سقف الشعار/QR، مجموع نسب 100%).
- `document-modern.test.tsx`: 13 (غياب المربع الملوّن، شارة draft/cancelled لا posted، طي الأقسام، QR 88px، table-fixed، ثنائي اللغة، هاتف في التذييل، 1/5/20 بنداً، عزل ERP/Minimal).
- `from-invoice.test.ts`: +2 لتمرير الحالة/الاستحقاق/الإجماليات وحذف الأصفار.
- `template-styles.test.ts`: يثبت Classic/ERP/Minimal/Retail دون تغيير.
- `visual-v2-print.test.ts`: عزل CSS الطباعة.
- الاختبارات القائمة (`doc-items-table` monospace، `doc-parties`، `document-body`، `document-qa-fixtures`، `template-export-contract`) لم تُضعَف.

### PHP

لم يُمسّ backend. **`php artisan test` لم يُشغَّل** — لا هجرات ولا خدمات محاسبية.

### Frontend build

`npm run build` (Next.js 15.5.19) نجح على الالتزام الأول `d962a31e`. الالتزام الثاني `33d85cf7` تعديل نسب/حشو/اختبارات فقط.

---

## Visual QA

نُفِّذ عبر Playwright على `/document-qa` محلياً (`http://127.0.0.1:3001`) بعد `next dev`، **بلا جلسة مستأجر**. اللقطات في `/opt/cursor/artifacts/`:

| الملف | السيناريو |
| --- | --- |
| `modern_invoice_rtl_five_v2.png` | فاتورة ضريبية، Modern، RTL، 5 بنود |
| `modern_invoice_ltr_single_v2.png` | LTR إنجليزي، بند واحد |
| `modern_invoice_rtl_long_content_v2.png` | محتوى طويل RTL |
| لقطات `_document` الأولى | كشفت تراكب الأعمدة في LTR قبل إصلاح النسب |

ما ظهر بعد الإصلاح:

- رأس منطقتين، بلا بطاقات أطراف، تاريخ/استحقاق/دفع في هوية المستند.
- QR قرب الإجماليات لا في الرأس.
- خصم/شحن/تسوية ظاهرة من قيم الـ fixture (ليست حساباً في العارض).
- شعار QA الأزرق هو **صورة الـ fixture** (`logoUrl`)، ليس مربع الاحتياط الذي حُذف عند الغياب.

ما لم يُنفَّذ:

- نقر طباعة/PDF من شاشة فاتورة مستأجر حقيقي.
- مجموعة Playwright e2e الكاملة (`document-qa.spec.ts`؛ مهلة 900s ومصفوفة أنواع/قوالب).
- معاينة مسودة/ملغى على بيانات أعمال — الشارة مغطاة في Vitest فقط.

---

## Build / CI

| الأمر | النتيجة |
| --- | --- |
| `php artisan test` | غير مشغَّل (لا backend) |
| `npm run test` | 189 ملفاً / 1122 اختباراً |
| `npm run build` | نجح على `d962a31e` |
| GitHub CI | يُراقَب على PR #616 بعد الدفع |

---

## Safety Review

| المحور | النتيجة |
| --- | --- |
| **Tenant Isolation** | لا مسارات API جديدة |
| **Branch isolation** | لا نماذج جديدة |
| **Accounting** | **لا قيد.** لا `LedgerService`. لا كتابة `journal_*` |
| **ZATCA** | QR يُعرض إن وُجد؛ لا توليد TLV/UBL |
| **migrations** | لا |
| **تجميد المراجعات** | العقد كما هو؛ تغيّر مظهر القالب المختار `tax-invoice-modern` فقط |

---

## Risks / Remaining Work

- التخطيط الافتراضي للفاتورة الضريبية ما زال يخفي الملاحظات/البنك/الختم حتى يفعّلها تصميم القالب — قد يظن المراجع أن الأقسام «لا تعمل» على `/document-qa` بنوع `tax_invoice`.
- عشرة أعمدة افتراضية على A4 تبقى كثيفة؛ النسب 100% تمنع التراكب لكن الأرقام+رمز الريال تضغط الخلايا. تخصيص الأعمدة من المصمّم هو صمام الأمان.
- ثنائي اللغة يعتمد locale الواجهة × اتجاه المستند؛ لا حقل API `bilingual`.
- Classic/Retail لم يُعاد تصميمهما (خارج النطاق).
- التحقق اليدوي على فاتورة مرحّلة بمستأجر تجريبي ما زال مفيداً قبل الدمج.

---

## Explicit exclusions respected

ERP · Classic · Minimal · Retail · Thermal · Quotes · Purchase Orders · Credit/Debit Notes · Purchase Invoices · Vouchers · ZATCA generation · accounting · API/DB schema · revision freeze contract · second renderer · Merge · Deploy.

---

## Git Metadata

- **Branch:** `cursor/invoice-visual-v2-modern-7cc0`
- **PR:** [#616](https://github.com/safwan5001-source/Nebrax/pull/616)
- **Base SHA:** `36525584b4545ef511c839b04ce3bc7f2535aa2e`
- **Implementation SHA:** `33d85cf7b03cd414f5b50885349a951654a8d0e5`
- **CI-green SHA:** غير مسجَّل بعد (Web CI بعد هذا الدفع)
- **Final Head SHA:** سيُذكر بعد التزام هذا التقرير إن وُجد؛ لا التزام لاحق لمجرد مطابقة SHA
- **عدد commits (كود):** 2
- **Merge:** لم يُدمَج
- **Deploy:** لم يُنشَر

---

## Next Step

مراجعة [#616](https://github.com/safwan5001-source/Nebrax/pull/616) بصرياً على `/document-qa?template=tax-invoice-modern` ثم دمجها يدوياً. لم يُدمَج من هذا الوكيل.

الخطوة التالية المقترحة (دون تنفيذ): Classic أو Minimal بنفس أساس V2، أو تمرير `status` في fixtures صفحة QA لعرض شارة المسودة.

---

## ملحق: الأثر المحاسبي

لا قيد. هذا تغيير عرض لقالب الطباعة فقط.

| العملية | مدين | دائن |
| --- | --- | --- |
| عرض/طباعة/PDF فاتورة Modern | — | — |
