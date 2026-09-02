# تقرير تنفيذ Invoice Visual V2 — Foundation + Modern Template

**المشروع:** نبراس / أَوْج ERP  
**المستودع:** `safwan5001-source/Nebrax`  
**التاريخ:** 2026-09-02  
**القاعدة:** أساس بصري V2 + إعادة تصميم قالب `tax-invoice-modern` للفاتورة فقط — معاينة/طباعة/PDF، عربي/إنجليزي/ثنائي. لا ERP/Classic/Minimal/Retail، لا عروض/أوامر شراء/إشعارات/فواتير مشتريات/سندات، لا محاسبة/ZATCA/schema، لا محرّك عارض ثانٍ، لا دمج، لا نشر.

---

## Executive Summary

أُعيد تصميم قالب **Modern** (`tax-invoice-modern`) ليبدو مستنداً مالياً رسمياً بدل بطاقة واجهة: رأس بهويتين (منشأة | مستند)، طرفان بلا بطاقات، جدول بنود `table-fixed` بطل الصفحة، إجماليات بفاصل هوية رفيع، وQR أصغر قرب الملخص. الأساس في `visual-v2.ts` توكنز عرض محلية لا تُحفظ في المراجعة.

العارض بقي كما هو: `InvoiceDocument` → `DocumentView` → `DocumentBody` → `#print-root` / `#pdf-print-root`. لم يُمسّ `document-output-template.ts`. الحقول الاختيارية (`status`، `due_date`، `discount`، `shipping`، `adjustment`) تُمرَّر من بيانات الفاتورة القائمة للعرض فقط — **بلا إعادة حساب**.

### جولة الصقل البصري (PR #616 — متابعة)

مصدر الازدحام بعد الجولة الأولى: عشر أعمدة + تكرار وحدة العملة داخل كل خلية (`﷼` يظهر كـ «ريال») + شبكة الملخص `col-start-8` تترك فراغاً أفقياً.

| المحور | بعد الصقل |
| --- | --- |
| نسب الأعمدة | 3 / 8 / 8 / 19 / 21 / 5 / 8 / 10 / 8 / 10 — المجموع **100%**؛ المنتج+الوصف ما زالا الأوسع |
| خلايا المال | رقم فقط (`nowrap` + `num`)؛ الوحدة في الرأس: `الإجمالي (ريال)` / `Total (SAR)` |
| عملة Modern | `ريال` في `ar`، و`SAR` في `en` و`bilingual`. لم يُمس `currency.ts` ولا `money.ts` |
| رؤوس المال | تلتف داخل الخلية (لا `nowrap`) حتى لا تتراكب تسميات `(ريال)`/`(SAR)` في `table-fixed` |
| الأكواد | رمز المنتج يلتف عند `-`؛ الباركود `ellipsis` بلا `break-all` |
| الشعار | سقف **36px** و`max-w-[5.5rem]`؛ الاسم `text-[16px] font-bold` |
| خط التمييز | `h-px` بـ `--border` بدل شريط `--doc-brand` |
| الملخص | `flex items-end justify-between gap-6`؛ QR **76px**؛ إجماليات `max-w-[300px]` |
| الفراغ | `MODERN_STYLE.sectionGap`: `mt-4` |
| الأطراف | `gap-x-12` وعناوين `text-[11px] font-semibold` |
| التذييل | `text-[10px]` وهواتف `text-[11px] num` |

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
- QR 110px داخل `rounded-lg` (صار 76px بعد الصقل).
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

منطقتان: هوية المنشأة (شعار `object-contain` ≤**36px** و`max-w-[5.5rem]`، اسم `text-[16px] font-bold` مع `line-clamp-2`، VAT/CR/عنوان) | هوية المستند (عنوان ثنائي مضغوط، رقم مرة واحدة، تاريخ، استحقاق إن وُجد، نوع الدفع). بلا مربع احتياطي ملوّن عند غياب الشعار. خط التمييز تحت العنوان `h-px` بـ `--border`. شارة `draft`/`cancelled` فقط — ليس `posted`.

### الأطراف

عمودان بلا بطاقات. البائع في الأطراف: الاسم + الرقم الضريبي (السجل والعنوان في الرأس). المشتري: الاسم + الضريبي + المدينة. الحقول الفارغة تنهار عبر `DocInfoRow`. الهاتف/الجوال في التذييل.

### الجدول

`table-fixed`، نسب الأعمدة العشرة الافتراضية مجموعها **100%** (حارس اختبار). وصف/منتج `break-words` و`text-[11px]`. رمز المنتج يلتف عند `-`؛ الباركود `ellipsis`. خلايا المال رقم فقط؛ الوحدة مرة في الرأس. رؤوس المال تلتف داخل عرض العمود. بلا تناوب ملوّن. تكرار `thead` في الطباعة مقيّد بـ `[data-doc-composition="modern"]`.

### الإجماليات وQR والتذييل

إجماليات بلا بطاقة زرقاء؛ إبراز بالوزن وفاصل `--doc-brand` رفيع؛ `max-w-[300px]`. الملخص `flex justify-between` (QR عند `start`، الإجماليات عند `end`). QR **76px** إن وُجد. ملاحظات/بنك/شروط: فاصل + عنوان، تنهار عند الفراغ. التذييل هادئ `mt-auto` مع هاتف/جوال `text-[11px]`.

### تمرير البيانات (عرض فقط)

`SourceInvoice` يقبل اختيارياً: `status`، `due_date`، `discount`، `shipping`، `adjustment`. التحويل إلى هللات عبر `riyalToMinor` القائم. الصفر يُحذف فلا يظهر سطراً فارغاً. POS والمعاينة بلا هذه الحقول يبقيان كما هما.

---

## Changed Files

| ملف | الدور |
| --- | --- |
| `web/src/modules/documents/presentation/visual-v2.ts` | توكنز V2، تسميات ثنائية، نسب الأعمدة 100%، سقف الشعار 36px وQR 76px، مساعدات عملة Modern |
| `web/src/modules/documents/presentation/use-document-label-mode.ts` | حسم ar/en/bilingual من locale والاتجاه |
| `web/src/modules/documents/presentation/visual-v2.test.ts` | عقد الأساس + عملة ريال/SAR |
| `web/src/modules/documents/presentation/visual-v2-print.test.ts` | عزل CSS الطباعة عن بقية القوالب |
| `web/src/modules/documents/templates/template-styles.ts` | `MODERN_STYLE`: بلا بطاقات، `tableHead: plain`، `sectionGap: mt-4` |
| `web/src/modules/documents/templates/tax-invoice-modern.tsx` | تعليق الهوية الرسمية |
| `web/src/modules/documents/types/index.ts` | `status?` عرضي على النموذج |
| `web/src/modules/documents/builder/from-invoice.ts` | تمرير الحقول الاختيارية القائمة |
| `web/src/modules/documents/components/sections/doc-layout.tsx` | `data-doc-composition` |
| `web/src/modules/documents/components/sections/doc-header.tsx` | رأس Modern |
| `web/src/modules/documents/components/sections/doc-parties.tsx` | عمودان بلا بطاقات، `gap-x-12` |
| `web/src/modules/documents/components/sections/doc-items-table.tsx` | table-fixed + نسب 100% + مبالغ رقمية |
| `web/src/modules/documents/components/sections/doc-totals.tsx` | بلا بطاقة brand-soft؛ `formatModernMoney` |
| `web/src/modules/documents/components/sections/doc-qr.tsx` | 76px |
| `web/src/modules/documents/components/sections/doc-summary.tsx` | `flex justify-between` و`data-doc-keep=summary` |
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
| سقف شعار 36px وQR 76px | الاسم القانوني أقوى من الشعار؛ QR لا يهيمن على الملخص |
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

## جولة التغطية الثنائية (Final Bilingual Coverage)

التصميم البصري المعتمد (نسب الأعمدة 100%، QR 76px، شعار 36px، ملخص `flex justify-between`، `sectionGap: mt-4`) **لم يُغيَّر**. الاستثناء الوحيد: كل رؤوس أعمدة Modern صارت `whitespace-normal break-words` حتى يلتف `العربية | English` داخل العرض الثابت.

عند `labelMode === bilingual` تُعرض التسميات من كتالوج `visual-v2` بصيغة **العربية | English**:

| السطح | المصدر |
| --- | --- |
| رأس/ميتا | `modernFieldLabel` + عنوان `localizedPair` |
| أطراف | بائع/مشتري (أو منشأة/عميل/مورد حسب النوع) + VAT/مدينة |
| رؤوس الجدول | `modernColumnLabel`؛ العمود المخصّص يبقى كما خُزن |
| إجماليات | `modernTotalLabel` |
| ملاحظات/شروط/بنك/توقيع | `modernFieldLabel` |
| تفقيط | تسمية ثنائية؛ قيمة الحروف لغة واحدة |
| QR | ملاحظة البيانات إن وُجدت؛ وإلا `zatca_note` ثنائي |
| تذييل | `footerText`/محتوى القالب إن وُجد؛ وإلا نص ZATCA الثنائي |
| ختم | بلا تسمية ظاهرة (لم تُختَرع) |

القيم (رقم، تاريخ، مبلغ، كمية، VAT) مرة واحدة. أسماء الشركة/العميل/المنتج/الوصف من البيانات كما هي. العملة في الثنائي **SAR**. العربية والإنجليزية المنفردتان بلا فاصل ` | `.

---

## Tests

### Vitest — `npm run test` في `web/` (بعد التغطية الثنائية)

```
Test Files  189 passed (189)
Tests       1135 passed (1135)
Duration    20.92s
```

منها:

- `visual-v2.test.ts`: 22 (كتالوج bilingual لكل حقل/عمود/إجمالي/حالة؛ `#` بلا تكرار؛ رأس المال `الإجمالي | Total (SAR)`).
- `document-modern.test.tsx`: 20 (كل تسميات Modern الظاهرة ثنائية في `FULL_LAYOUT`؛ تسمية عمود مخصّصة بلا ترجمة؛ عربي/إنجليزي بلا ` | `؛ عزل ERP عن الزوج الثنائي).
- بقية حراسة الصقل البصري كما هي.

### PHP

لم يُمسّ backend. **`php artisan test` لم يُشغَّل** — لا هجرات ولا خدمات محاسبية.

### Frontend build

`npm run build` (Next.js 15.5.19) نجح محلياً على جولة التغطية الثنائية.

---

## Visual QA

نُفِّذ عبر Playwright على `/document-qa?template=tax-invoice-modern` محلياً (`http://127.0.0.1:3001`)، **بلا جلسة مستأجر**. لقطات `#qa-print-root` في `/opt/cursor/artifacts/`.

### جولة التغطية الثنائية (r3) — إلزامية

locale الواجهة `en` + `direction=rtl` → `labelMode=bilingual`. فحص إحداثيات `th`: **صفر تراكب**. `tableOverflowPx = 0`.

| الملف | السيناريو |
| --- | --- |
| `modern_v2_bilingual_rtl_en_five_r3.png` | فاتورة ضريبية، 5 بنود — كل التسميات `العربية \| English`، العملة SAR، القيم مرة واحدة |
| `modern_v2_bilingual_rtl_en_long_content_r3.png` | محتوى طويل — رؤوس الأعمدة تلتف بلا قصّ أو تراكب |
| `modern_v2_bilingual_rtl_en_quotation_five_r3.png` | عرض سعر (يُظهر ملاحظات/شروط/بنك/توقيع ثنائية؛ التخطيط الافتراضي للفاتورة يخفيها) |
| `modern_v2_bilingual_qa_inspect_r3.json` | مقاييس التراكب والنصوص |

ملاحظات البيانات (`رمز تحقق خاص بالمعاينة`) ونص التذييل من الـ fixture بقيا كما هما — ليسا تسميات.

### جولة الصقل السابقة (مرجع)

| الملف | السيناريو |
| --- | --- |
| `modern_polish_rtl_ar_single.png` | RTL عربي، بند واحد |
| `modern_polish_rtl_ar_five.png` | RTL عربي، 5 بنود |
| `modern_polish_rtl_ar_twenty.png` | RTL عربي، 20 بنداً |
| `modern_polish_rtl_ar_multipage.png` | RTL عربي، 40 بنداً (multipage) |
| `modern_polish_ltr_en_single.png` | LTR إنجليزي، بند واحد |
| `modern_polish_ltr_en_five.png` | LTR إنجليزي، 5 بنود |
| `modern_polish_bilingual_five.png` | ثنائي: `direction=rtl` + locale `en`، 5 بنود |
| `modern_polish_rtl_ar_long_content.png` | محتوى طويل + شعار + QR |

فحص آلي لإحداثيات `th`: **صفر تراكب** في عربي RTL وإنجليزي LTR وثنائي. `tableOverflowPx = 0`. خلايا الجدول بلا `ريال`/`SAR`/`﷼`. الإجماليات: `ريال` عربياً و`SAR` إنجليزي/ثنائي. الملخص `flex justify-between`. الشعار 36px وQR 76px.

ما ظهر:

- رأس منطقتين، بلا بطاقات أطراف، تاريخ/استحقاق/دفع في هوية المستند.
- QR عند بداية الملخص والإجماليات عند نهايته (RTL وLTR).
- خصم/شحن/تسوية ظاهرة من قيم الـ fixture (ليست حساباً في العارض).
- شعار QA الأزرق هو **صورة الـ fixture** (`logoUrl`)، ليس مربع الاحتياط الذي حُذف عند الغياب.
- التخطيط الافتراضي لـ `tax_invoice` ما زال يخفي الملاحظات/البنك/الختم على `/document-qa` ما لم يُفعَّل التخطيط الكامل.

ما لم يُنفَّذ:

- نقر طباعة/PDF من شاشة فاتورة مستأجر حقيقي.
- مجموعة Playwright e2e الكاملة (`document-qa.spec.ts`؛ مهلة 900s ومصفوفة أنواع/قوالب).
- معاينة مسودة/ملغى على بيانات أعمال — الشارة مغطاة في Vitest فقط.

---

## Build / CI

| الأمر | النتيجة |
| --- | --- |
| `php artisan test` | غير مشغَّل (لا backend) |
| `npm run test` | 189 ملفاً / **1135** اختباراً (بعد التغطية الثنائية) |
| `npm run build` | نجح محلياً (Next.js 15.5.19) |
| GitHub CI | **نجح** سابقاً على `cec89b79` و`3ddf2f16`. التزام التغطية الثنائية `534b3911` مدفوع على نفس الفرع؛ لا دمج |

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
- عشرة أعمدة افتراضية على A4 تبقى كثيفة؛ نقل الوحدة إلى الرأس وإتاحة التفاف الرأس يمنع تراكب `(ريال)`/`(SAR)`. تخصيص الأعمدة من المصمّم يبقى صمام الأمان.
- ثنائي اللغة يعتمد locale الواجهة × اتجاه المستند؛ لا حقل API `bilingual`.
- Classic/Retail لم يُعاد تصميمهما (خارج النطاق).
- التحقق اليدوي على فاتورة مرحّلة بمستأجر تجريبي ما زال مفيداً قبل الدمج.

---

## Explicit exclusions respected

ERP · Classic · Minimal · Retail · Thermal · ZATCA generation · accounting · API/DB schema · revision freeze contract · second renderer · Merge · Deploy.

(تسميات Modern تُطبَّق إن اختير القالب نفسه لنوع تجاري في `/document-qa`؛ لا إعادة تصميم لتلك الأنواع.)

---

## Git Metadata

- **Branch:** `cursor/invoice-visual-v2-modern-7cc0`
- **PR:** [#616](https://github.com/safwan5001-source/Nebrax/pull/616)
- **Base SHA:** `36525584b4545ef511c839b04ce3bc7f2535aa2e`
- **Implementation SHA:** `534b3911c770fb87822827c4085a68ee6b0d5cb7` (آخر التزام كودي — التغطية الثنائية؛ لا التزام لاحق لمجرد مطابقة Head)
- **Implementation SHA (صقل بصري):** `217f0e679f2a19915f336b1da92176b57df3d9b3`
- **CI-green SHA:** `cec89b79ba74f132f103e839053d07a9c0dee8bd` (5/5 على الجولة الأولى)
- **عدد commits (كود هذه الجولة):** `534b3911`
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
