# تقرير تنفيذ Invoice Visual V2 — Foundation + Modern Template

**المشروع:** نبراس / أَوْج ERP  
**المستودع:** `safwan5001-source/Nebrax`  
**التاريخ:** 2026-09-02  
**القاعدة:** أساس بصري V2 + قالب Modern رسمي. **الجولة الحالية:** فصل هوية السجل حتى يبقى `tax-invoice-modern` على الشكل التاريخي (ما قبل #616) ويُختار V2 صراحةً عبر `tax-invoice-modern-v2`. لا migration، لا إعادة كتابة تعيينات/مراجعات، لا محاسبة/ZATCA/schema، لا محرّك عارض ثانٍ، لا دمج، لا نشر.

---

## Executive Summary

أُعيد تصميم قالب **Modern V2** ليبدو مستنداً مالياً رسمياً بدل بطاقة واجهة: رأس بهويتين (منشأة | مستند)، طرفان بلا بطاقات، جدول بنود `table-fixed` بطل الصفحة، إجماليات بفاصل هوية رفيع، وQR أصغر قرب الملخص. الأساس في `visual-v2.ts` توكنز عرض محلية لا تُحفظ في المراجعة.

**عقد الهويات (جولة ثبات المظهر التاريخي):** التجميد يخزّن UUID مراجعة + JSON فيه `template_id` نصي، **لا** يجمّد مكوّن React. لذلك لا يكفي تعديل `composition === 'modern'` in-place:

| الهوية | التركيب | الشكل |
| --- | --- | --- |
| `tax-invoice-modern` | `modern` | الشكل التاريخي ما قبل #616 (بطاقات، رأس بشريط جانبي، QR 110px) |
| `tax-invoice-modern-v2` | `modern_v2` | التصميم المعتمد في #616 (فواصل رفيعة، bilingual/Bidi، QR 76px) |

التعيينات الحية الحالية على `tax-invoice-modern` ترجع تلقائياً للشكل القديم لأن العارض يحلّ المعرّف كما هو. V2 خيار كتالوج جديد فقط. المسودة تتبع التعيين الحي؛ المرحّل يتبع المراجعة المجمّدة. `DEFAULT_TEMPLATE_ID` يبقى `tax-invoice-classic`. لا alias من modern إلى v2.

العارض بقي كما هو: `InvoiceDocument` → `DocumentView` → `DocumentBody` → `#print-root` / `#pdf-print-root`. لم يُمسّ `document-output-template.ts` دلالياً. الحقول الاختيارية (`status`، `due_date`، `discount`، `shipping`، `adjustment`) تُمرَّر من بيانات الفاتورة القائمة للعرض فقط — **بلا إعادة حساب**.

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

الجولة الأولى أعادت تصميم `tax-invoice-modern` in-place. **الجولة الحالية تعكس ذلك القرار بصرياً على تلك الهوية** وتسجّل `tax-invoice-modern-v2` للمعتمد، حتى لا تُعاد تفسير التعيينات والمراجعات التاريخية.

لا blocker محاسبي أو ZATCA أو schema. لا PHP. لا migration.

---

## Implementation

فروع `style.composition === 'modern_v2'` للتصميم المعتمد، و`modern` للشكل التاريخي. ERP / Minimal / Classic / Retail لم تُغيَّر توكنزها (محروس باختبار).

### الرأس

منطقتان: هوية المنشأة (شعار `object-contain` ≤**36px** و`max-w-[5.5rem]`، اسم `text-[16px] font-bold` مع `line-clamp-2`، VAT/CR/عنوان) | هوية المستند (عنوان ثنائي مضغوط، رقم مرة واحدة، تاريخ، استحقاق إن وُجد، نوع الدفع). بلا مربع احتياطي ملوّن عند غياب الشعار. خط التمييز تحت العنوان `h-px` بـ `--border`. شارة `draft`/`cancelled` فقط — ليس `posted`.

### الأطراف

عمودان بلا بطاقات. البائع في الأطراف: الاسم + الرقم الضريبي (السجل والعنوان في الرأس). المشتري: الاسم + الضريبي + المدينة. الحقول الفارغة تنهار عبر `DocInfoRow`. الهاتف/الجوال في التذييل.

### الجدول

`table-fixed`، نسب الأعمدة العشرة الافتراضية مجموعها **100%** (حارس اختبار). وصف/منتج `break-words` و`text-[11px]`. رمز المنتج يلتف عند `-`؛ الباركود `ellipsis`. خلايا المال رقم فقط؛ الوحدة مرة في الرأس. رؤوس المال تلتف داخل عرض العمود. بلا تناوب ملوّن. تكرار `thead` في الطباعة مقيّد بـ `[data-doc-composition="modern_v2"]`.

### الإجماليات وQR والتذييل

إجماليات بلا بطاقة زرقاء؛ إبراز بالوزن وفاصل `--doc-brand` رفيع؛ `max-w-[300px]`. الملخص `flex justify-between` (QR عند `start`، الإجماليات عند `end`). QR **76px** إن وُجد. ملاحظات/بنك/شروط: فاصل + عنوان، تنهار عند الفراغ. التذييل هادئ `mt-auto` مع هاتف/جوال `text-[11px]`.

### تمرير البيانات (عرض فقط)

`SourceInvoice` يقبل اختيارياً: `status`، `due_date`، `discount`، `shipping`، `adjustment`. التحويل إلى هللات عبر `riyalToMinor` القائم. الصفر يُحذف فلا يظهر سطراً فارغاً. POS والمعاينة بلا هذه الحقول يبقيان كما هما.

### جولة فصل الهويات (تنفيذ معتمد)

| المحور | النتيجة |
| --- | --- |
| سجل الواجهة | `tax-invoice-modern-v2` مدخل جديد في `TEMPLATES`؛ `getTemplate` المجهول يسقط إلى classic كما كان |
| التركيب | فروع V2 على `modern_v2`؛ فروع `modern` مستعادة من `36525584` |
| التعيينات الحية | بلا كتابة: من كان على `tax-invoice-modern` يرى التاريخي تلقائياً |
| المرحّل | `resolveDocumentOutputTemplates` يمرّر `template_id` كما جُمِّد؛ لا alias |
| المسودة | تتبع التعيين الحي (`modern` أو `modern-v2`) |
| Print / PDF | كلا المعرّفين A4 متاحان في الكتالوج (`listTemplates`) والاستوديو؛ PDF يسقط إلى print عند غياب تعيين pdf كما كان |
| Thermal | بلا تغيير؛ القائمة البيضاء تبقى `thermal58`/`thermal80` فقط |
| Backend | لم يُمس. `PrintTemplateContract` لا يبيّض معرّفات A4؛ لا migration |
| الافتراضي | `DEFAULT_TEMPLATE_ID = tax-invoice-classic` |

---

## Changed Files

| ملف | الدور |
| --- | --- |
| `web/src/modules/documents/presentation/visual-v2.ts` | توكنز V2، تسميات ثنائية، نسب الأعمدة 100%، سقف الشعار 36px وQR 76px، مساعدات عملة Modern |
| `web/src/modules/documents/presentation/modern-bilingual-label.tsx` | عقدتان معزولتان للتسمية الثنائية في تركيب Modern فقط |
| `web/src/modules/documents/presentation/modern-bilingual-label.test.tsx` | عزل dir ووحدة SAR على السطر الإنجليزي |
| `web/src/modules/documents/presentation/use-document-label-mode.ts` | حسم ar/en/bilingual من locale والاتجاه |
| `web/src/modules/documents/presentation/visual-v2.test.ts` | عقد الأساس + عملة ريال/SAR |
| `web/src/modules/documents/presentation/visual-v2-print.test.ts` | عزل CSS الطباعة عن بقية القوالب |
| `web/src/modules/documents/templates/template-styles.ts` | `MODERN_STYLE` تاريخي + `MODERN_V2_STYLE` معتمد |
| `web/src/modules/documents/templates/tax-invoice-modern.tsx` | يغلف `DocumentBody` بـ `MODERN_STYLE` التاريخي |
| `web/src/modules/documents/templates/tax-invoice-modern-v2.tsx` | هوية V2 الجديدة |
| `web/src/modules/documents/registry/templates.ts` | سجل الهويتين؛ بلا alias؛ الافتراضي classic |
| `web/src/app/globals.css` | قواعد طباعة مقيّدة بـ `modern_v2` |
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
| `web/src/modules/documents/components/document-modern.test.tsx` | عرض jsdom لتركيب `modern_v2` |
| `web/src/modules/documents/components/document-legacy-modern.test.tsx` | انحدار الشكل التاريخي |
| `web/src/modules/documents/registry/templates.test.ts` | استقلال الهويتين |
| اختبارات styles / from-invoice / items-table | حراسة عدم كسر القوالب الأخرى |

لم يُمسّ: `document-output-template.ts`، قوالب ERP/Classic/Minimal/Retail، PHP، الهجرات، ZATCA generation.

---

## Visual Decisions

| القرار | السبب |
| --- | --- |
| لا قالب بمعرّف جديد *(نُقض لاحقاً)* | الجولة الأولى أعادت تصميم `tax-invoice-modern`؛ الجولة الحالية تسجّل `tax-invoice-modern-v2` لثبات التاريخ |
| `cardRadius: rounded-none` و`tableHead: plain` | مستند رسمي لا بطاقة UI |
| بلا مربع شعار ملوّن | يخالف «لا صناديق ملوّنة»؛ الغياب = اسم فقط |
| سقف شعار 36px وQR 76px | الاسم القانوني أقوى من الشعار؛ QR لا يهيمن على الملخص |
| ميتا المستند في الرأس لا عمود ثالث | بطاقة لكل حقل تضعف الجدول |
| أطراف عمودين؛ البائع بدون تكرار السجل/العنوان | الهوية القانونية في الرأس؛ الفاتورة إلى للمشتري |
| نسب أعمدة مجموعها 100% | أول لقطة LTR أظهرت تراكب باركود/منتج عندما تجاوز المجموع 100% |
| شارة المسودة/الملغى فقط | المرحّل هو الحالة الطبيعية فلا وسْم |
| قواعد `thead`/`break-inside` تحت `[data-doc-composition=modern_v2]` | لا تُطبَّق على Modern التاريخي ولا ERP/Minimal |
| اتجاه منطقي `start`/`end` | لا `left`/`right` في توكنز الشعار |

الثيم ما زال عبر `--doc-brand*`؛ لا hex مبعثر في الأقسام.

---

## Compatibility

| المحور | النتيجة |
| --- | --- |
| ERP / Classic / Minimal / Retail | توكنزها ثابتة باختبار `template-styles.test.ts`؛ فروع التركيب لم تُمس |
| عقد التصدير | `#print-root` / `#pdf-print-root` كما في #611–#614 |
| المراجعات المجمّدة | `template_id` النصي هو مصدر الشكل: `tax-invoice-modern` → تاريخي، `tax-invoice-modern-v2` → V2. تغيير التعيين الحي بعد الترحيل لا يغيّر المرحّل |
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

## جولة تصحيح Bidi (تسميات Modern الثنائية)

التغطية الثنائية **مقبولة** ولم تُعد ترجمتها ولا أُعيد تصميم Modern. العيب كان أن `pairLabel` يبني `"${ar} | ${en}"` كنص DOM واحد داخل فقرة RTL، فيعيد المتصفح ترتيب الرقم/`|`/اللاتينية (مثال شبيه بـ `Invoice No.TAX_INVOICE... | رقم الفاتورة`).

**القرار البصري:** في `bilingual` تُعرض التسمية **سطرين** معزولين — عربي `dir="rtl"` ثم إنجليزي `dir="ltr"` — والقيمة عقدة منفصلة. لا أحرف اتجاه يونيكود داخل سلاسل الأعمال. العربية-فقط والإنجليزية-فقط تبقيان سطراً واحداً. نسب الأعمدة 100% وQR 76px وشعار 36px لم تُمس.

| السطح | بعد التصحيح |
| --- | --- |
| مكوّن | `ModernBilingualLabel` — وسم `data-modern-bilingual="label"` عندما `ar !== en` |
| كتالوج | `pairLabel` / `modernFieldLabel(..., 'bilingual')` يبقيان `"ar \| en"` للاختبارات الوحدوية — **ممنوع** كنص DOM ثنائي في Modern |
| `DocInfoRow` | `label: React.ReactNode`؛ القيمة في `[data-doc-info-value]`؛ أرقام/معرّفات لاتينية `dir="ltr"`؛ العنوان الوطني باتجاه المستند |
| رؤوس المال | `Unit price (SAR)` على السطر الإنجليزي فقط؛ الخلايا رقم بلا وحدة |
| إجماليات | تسمية معزولة عن `.num`؛ صفوف Modern `items-start` |
| ERP/Minimal | بلا `data-modern-bilingual` حتى مع `locale=en` + `direction=rtl` |

---

## Tests

### Vitest — `npm run test` في `web/` (بعد فصل الهويات)

```
Test Files  192 passed (192)
Tests       1155 passed (1155)
Duration    21.39s
```

منها:

- `templates.test.ts`: 3 — `getTemplate('tax-invoice-modern')` ≠ V2؛ المجهول → classic؛ لا alias.
- `document-output-template.test.ts`: تجميد modern يبقى تاريخياً، تجميد v2 يبقى v2، المسودة تتبع الحي، الملف بلا alias.
- `document-legacy-modern.test.tsx`: 6 — `composition=modern`، 3 بطاقات، مربع شعار احتياطي، QR 110px، بلا `data-modern-bilingual`.
- `document-modern.test.tsx`: 21 — بقيت على `MODERN_V2_STYLE` / `data-doc-composition="modern_v2"`.
- `visual-v2.test.ts`: 22 (كتالوج bilingual ما زال `"ar | en"`).
- `modern-bilingual-label.test.tsx`: 4 (عقدتان معزولتان؛ `#` سطر واحد؛ ar/en بلا وسم؛ SAR على الإنجليزي فقط).

### PHP

لم يُمسّ backend. **`php artisan test` لم يُشغَّل** — لا هجرات ولا خدمات محاسبية.

### Frontend build

`npm run build` (Next.js 15.5.19) نجح محلياً بعد فصل الهويات.

---

## Visual QA

نُفِّذ عبر Playwright على `/document-qa` محلياً (`http://127.0.0.1:3001`)، **بلا جلسة مستأجر**. لقطات `#qa-print-root` في `/opt/cursor/artifacts/` — أسماء جديدة بلا overwrite.

### جولة فصل الهويات (r5) — إلزامية

| الملف | السيناريو | المقاييس |
| --- | --- | --- |
| `identity_split_legacy_modern_rtl_ar_five.png` | `tax-invoice-modern`، عربي RTL، 5 بنود | `composition=modern`، 3 بطاقات أطراف، QR 110px، صفر bilingual، `tableOverflowPx=0` |
| `identity_split_modern_v2_bilingual_five.png` | `tax-invoice-modern-v2`، locale=en + RTL، 5 بنود | `composition=modern_v2`، 29 عقدة ثنائية، QR 76px، `data-doc-keep=summary`، بلا ` \| `، صفر تراكب |
| `identity_split_qa_inspect.json` | مقاييس التركيب | يؤكد أن الهويتين لا تشتركان في `composition` |

### جولة تصحيح Bidi (r4) — إلزامية

فحص إحداثيات `th`: **صفر تراكب**. `tableOverflowPx = 0`. في bilingual: 29 عقدة معزولة، بلا ` | ` داخل التسميات، القيمة خارج عقدة التسمية، `#` سطر واحد، `SAR` على السطر الإنجليزي في رؤوس المال، الخلايا بلا وحدة.

| الملف | السيناريو |
| --- | --- |
| `modern_v2_bidi_bilingual_five_r4.png` | فاتورة Modern، bilingual، 5 بنود — سطران عربي ثم إنجليزي؛ الرقم تحت التسمية |
| `modern_v2_bidi_bilingual_long_content_r4.png` | bilingual + محتوى عربي طويل — بلا قصّ/تراكب |
| `modern_v2_bidi_arabic_rtl_five_r4.png` | انحدار عربي RTL — سطر واحد، بلا `data-modern-bilingual` |
| `modern_v2_bidi_english_ltr_five_r4.png` | انحدار إنجليزي LTR — سطر واحد، بلا الوسم |
| `modern_v2_bidi_erp_quotation_five_r4.png` | انحدار مشترك: عرض سعر + قالب ERP — صفر عقد ثنائية |
| `modern_v2_bidi_qa_inspect_r4.json` | مقاييس العزل والتراكب |

### جولة التغطية الثنائية (r3) — مرجع

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
| `npm run test` | 192 ملفاً / **1155** اختباراً (بعد فصل الهويات) |
| `npm run build` | نجح محلياً (Next.js 15.5.19) |
| GitHub CI | **نجح** سابقاً على `cec89b79` و`3ddf2f16`. التزام الفصل `7048684d` مدفوع على نفس الفرع؛ لا دمج |

---

## Safety Review

| المحور | النتيجة |
| --- | --- |
| **Tenant Isolation** | لا مسارات API جديدة |
| **Branch isolation** | لا نماذج جديدة |
| **Accounting** | **لا قيد.** لا `LedgerService`. لا كتابة `journal_*` |
| **ZATCA** | QR يُعرض إن وُجد؛ لا توليد TLV/UBL |
| **migrations** | لا |
| **تجميد المراجعات** | العقد كما هو (UUID + `template_id` نصي). لا إعادة كتابة بيانات. الشكل يتبع الهوية لا آخر تصميم in-place |

---

## Risks / Remaining Work

- التخطيط الافتراضي للفاتورة الضريبية ما زال يخفي الملاحظات/البنك/الختم حتى يفعّلها تصميم القالب — قد يظن المراجع أن الأقسام «لا تعمل» على `/document-qa` بنوع `tax_invoice`.
- عشرة أعمدة افتراضية على A4 تبقى كثيفة؛ نقل الوحدة إلى الرأس وإتاحة التفاف الرأس يمنع تراكب `(ريال)`/`(SAR)`. تخصيص الأعمدة من المصمّم يبقى صمام الأمان.
- ثنائي اللغة يعتمد locale الواجهة × اتجاه المستند؛ لا حقل API `bilingual`. العرض الثنائي عقدتان معزولتان لا سلسلة `|`.
- Classic/Retail لم يُعاد تصميمهما (خارج النطاق).
- التحقق اليدوي على فاتورة مرحّلة بمستأجر تجريبي ما زال مفيداً قبل الدمج: تعيين حي `tax-invoice-modern` يجب أن يظهر تاريخياً؛ اختيار V2 يتم من الكتالوج صراحةً.

---

## Explicit exclusions respected

ERP · Classic · Minimal · Retail · Thermal · ZATCA generation · accounting · API/DB schema · إعادة كتابة التعيينات/المراجعات · migrations · second renderer · Merge · Deploy.

(تسميات Modern V2 تُطبَّق إن اختير `tax-invoice-modern-v2` لنوع تجاري في `/document-qa`؛ الهوية التاريخية `tax-invoice-modern` لا تحمل bilingual/Bidi.)

---

## Git Metadata

- **Branch:** `cursor/invoice-visual-v2-modern-7cc0`
- **PR:** [#616](https://github.com/safwan5001-source/Nebrax/pull/616)
- **Base SHA:** `36525584b4545ef511c839b04ce3bc7f2535aa2e`
- **Implementation SHA (فصل الهويات — كود):** `7048684d`
- **Implementation SHA (Bidi):** `529ddd2ed597b8dc085ae97ff03065d765edf8ce`
- **Implementation SHA (تغطية ثنائية سابقة):** `534b3911c770fb87822827c4085a68ee6b0d5cb7`
- **Implementation SHA (صقل بصري):** `217f0e679f2a19915f336b1da92176b57df3d9b3`
- **CI-green SHA:** `cec89b79ba74f132f103e839053d07a9c0dee8bd` (5/5 على الجولة الأولى)
- **Merge:** لم يُدمَج
- **Deploy:** لم يُنشَر

---

## Next Step

مراجعة [#616](https://github.com/safwan5001-source/Nebrax/pull/616) بصرياً على:

- `/document-qa?template=tax-invoice-modern` → الشكل التاريخي
- `/document-qa?template=tax-invoice-modern-v2` → V2 المعتمد

لم يُدمَج ولم يُنشَر من هذا الوكيل. لا migration لاحقة لهذا الفصل.

---

## ملحق: الأثر المحاسبي

لا قيد. هذا تغيير عرض لقالب الطباعة فقط.

| العملية | مدين | دائن |
| --- | --- | --- |
| عرض/طباعة/PDF فاتورة Modern | — | — |
