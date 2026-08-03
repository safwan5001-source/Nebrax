# مثال مرجعي: شاشة تفاصيل الفاتورة (Detail Screen)

توثيق كامل لشاشة تفاصيل مستند مالي موجودة فعلاً، مربوطة ببنود Design System v2.0. **المثال
المعياري لنمط «شاشة التفاصيل»** (عرض سجل + مصنوعاته: بيانات، حالة، سطور، ZATCA، طباعة).

- **المصدر (As-Is):** `web/src/app/(app)/invoices/[id]/page.tsx`
- **النمط:** «شاشة تفاصيل» — `patterns/ux-patterns.md` §2.
- **الحالة:** موثّق كما هو؛ انحرافان طفيفان مرصودان (§9).

بهذا تكتمل **ثلاثية الفاتورة:** قائمة (`invoices-screen.md`) ← نموذج (`invoice-form-screen.md`)
← تفاصيل (هذا الملف).

---

## 1. التشريح (Anatomy)

```
<div space-y-5>
├── رأس (flex items-center gap-3)
│   ├── زر رجوع (ghost/icon · no-print)
│   ├── <h1 num text-xl font-semibold> رقم الفاتورة
│   ├── Badge حالة المستند + Badge حالة السداد
│   └── (ms-auto) زر طباعة (outline/sm · no-print)
├── <div grid lg:grid-cols-3 gap-4>
│   ├── Card «التفاصيل» (lg:col-span-2) → قائمة تعريف (dl/dt/dd)
│   └── Card «ZATCA» → رمز QR + ICV/UUID (أو حالة معلّقة)
├── Card «البنود» → جدول قراءة فقط (ui/table)
└── <InvoiceDocument> → مستند A4 للطباعة فقط (print-only)
```

مطابق لنمط «شاشة التفاصيل» في `patterns/ux-patterns.md` §2: رأس (رجوع + معرّف + شارات) →
بطاقات معلومات → جداول فرعية.

## 2. رأس الشاشة (Header)

- **زر رجوع** `ghost/icon` بأيقونة `ArrowRight` (RTL) + `aria-label` + `no-print` — `patterns/ux-patterns.md` §8.
- **المعرّف كعنوان:** `<h1 num text-xl font-semibold>` = رقم الفاتورة (رقم → `.num`).
- **شارتا الحالة:** حالة المستند (`posted→positive` / `draft→muted` / `cancelled→negative`) + حالة
  السداد (`paid→positive` / `partial→warning` / `unpaid→muted`) — `financial/financial-ui.md` §4.
- **زر الطباعة:** `outline/sm` بأيقونة `Printer`، `ms-auto` + `no-print` (لا يظهر في المستند المطبوع).

## 3. بطاقة التفاصيل — نمط قائمة التعريف (Definition List)

عرض بيانات السجل عبر `<dl>` دلالياً:
```tsx
<dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
  <div><dt className="text-xs text-muted">{label}</dt><dd className="text-text">{value}</dd></div>
</dl>
```
- **`dt`** تسمية `text-xs text-muted` · **`dd`** قيمة `text-text`.
- القيم المالية/التواريخ بـ `.num`؛ الإجمالي `font-semibold`.
- **هذا هو النمط المعياري لعرض «حقل: قيمة»** في شاشات التفاصيل (استخدم `dl` لا جدولاً).

## 4. بطاقة ZATCA — رمز QR وحالة معلّقة

- رمز QR عبر **`QRCodeSVG`** (qrcode.react) داخل `rounded bg-white p-3` — الخلفية بيضاء دائماً
  لضمان مسح الرمز (استثناء موثّق للوضع الداكن).
- بيانات: `ICV`, `UUID` بـ `.num`.
- **حالة معلّقة** (مسودة بلا ZATCA): رسالة `text-xs text-muted` (`zatca_pending`) — حالة فارغة صريحة
  للبطاقة (`patterns/states.md` §2).
- الأمان: `QRCodeSVG` يرسم SVG — لا `dangerouslySetInnerHTML`، لا XSS.

## 5. جدول البنود (قراءة فقط) — `components/data-display.md`

- بدائيات `ui/table` (لا `DataTable` — عرض ثابت بلا بحث/تصدير).
- أعمدة: الوصف · الكمية · سعر الوحدة · الضريبة · الإجمالي.
- كل الأرقام `num text-end` + `formatRiyal`.
- **المستند مرحّل = قراءة فقط** (لا تحرير) — `financial/financial-ui.md` §5 (التصحيح بقيد عكسي).

## 6. الطباعة / PDF — `financial/financial-ui.md` §6

- `<InvoiceDocument>` = مستند A4 كامل (فاتورة ضريبية) يظهر **عند الطباعة فقط** عبر
  `@media print` + `#print-root` (في `globals.css`).
- عناصر التطبيق تحمل `no-print`؛ المستند يحمل `print-only`/`#print-root`.
- زر الطباعة يستدعي `window.print()` → يفتح حوار الطباعة/حفظ PDF.
- هذا هو **مسار PDF المعتمد للمستندات** (بدل مولّد PDF منفصل).

## 7. تحميل البيانات وتدرّج التراجع (Data & Graceful Degradation)

- **جلب أساسي ثم تابع:** الفاتورة أولاً، ثم `Promise.allSettled` للبيانات الثانوية
  (العميل، ZATCA، بيانات الشركة).
- **`allSettled`** يعني فشل أي مصدر ثانوي **لا يكسر الشاشة** — يظهر ما توفّر (تدرّج تراجع سليم).
  مطابق لروح `patterns/states.md` (لا طرق مسدودة).

## 8. الحالات (States) — `patterns/states.md`

| الحالة | التنفيذ |
|---|---|
| **Loading** | إرجاع مبكّر: `Skeleton` (عنوان + جسم) — `states.md` §1 ✅ |
| **Not-found** | `invoice === null` → رسالة `text-muted` (`not_found`) |
| **ZATCA فارغ** | رسالة معلّقة داخل بطاقة ZATCA ✅ |
| **Error** | — (انظر §9-A) |

## 9. رصد المطابقة (Compliance Findings)

الشاشة تجتاز معظم القواعد. رُصد انحرافان طفيفان (توثيق فقط):

| # | الانحراف | القاعدة | الشدّة | التوصية |
|---|---|---|---|---|
| A | الجلب الأساسي بلا `.catch`؛ **فشل الشبكة يظهر كـ «غير موجود»** (خلط الخطأ بالغياب) | `patterns/states.md` §3 | منخفضة-متوسطة | أضف `.catch` يميّز خطأ التحميل عن السجل غير الموجود |
| B | الرأس `flex items-center gap-3` بلا `flex-wrap` — قد يزدحم (رقم + شارتان + زر) على شاشة ضيقة | `layout/grid-system.md` §Layout Rules | منخفضة | `flex flex-wrap items-center gap-3` |

**يجتاز:** رموز فقط · خطّان + `.num` · RTL منطقي · شارات دلالية · قائمة تعريف دلالية ·
قراءة فقط للمرحّل · طباعة A4 · `allSettled` للتراجع · QR آمن · a11y (`aria-label`, `dl/dt/dd`).

## 10. الخلاصة (اختبار DS)

- **وُثِّقت الشاشة بالكامل من قواعد DS دون أي سؤال** → النظام مكتمل عند نمط التفاصيل أيضاً.
- هذه الشاشة **القالب المعياري لأي شاشة تفاصيل مستند** (فاتورة/مشترى/سند/مرتجع): رأس بشارات +
  قائمة تعريف + جداول فرعية قراءة فقط + طباعة A4 + تراجع سليم.
- الأنماط الثلاثة الأساسية موثّقة الآن بأمثلة حيّة (قائمة · نموذج · تفاصيل).

## مرجع سريع
- القائمة: `examples/invoices-screen.md` · النموذج: `examples/invoice-form-screen.md`.
- الوصفات وقائمة الفحص: `examples/recipes.md` · قواعد المال: `financial/financial-ui.md`.
