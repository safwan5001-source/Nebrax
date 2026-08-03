# مثال مرجعي: شاشة إنشاء فاتورة (Invoice Form / Document Screen)

توثيق كامل لشاشة نموذج مالي موجودة فعلاً، مربوطة ببنود Design System v2.0. **المثال
المعياري لنمط «المستند المالي»** (فاتورة/سند): سطور + ملخّص لاصق + إجماليات مشتقّة.

- **المصدر (As-Is):** `web/src/app/(app)/invoices/new/page.tsx`
- **النمط:** «شاشة نموذج» + «مستند مالي» — `patterns/ux-patterns.md` §3 و§5.
- **الحالة:** موثّق كما هو؛ لا انحرافات مادّية (يجتاز قواعد DS — القسم §10).

---

## 1. التشريح (Anatomy)

```
<div space-y-5>
├── شريط الإجراءات (flex flex-wrap items-center gap-3)
│   ├── زر رجوع (ghost/icon, ArrowRight)
│   ├── <h1 text-xl font-semibold> عنوان
│   └── (ms-auto) [إلغاء ghost] [حفظ كمسودة outline] [حفظ وترحيل primary]
└── <div grid lg:grid-cols-[1fr_300px] gap-5>          ← تخطيط مستند
    ├── العمود الرئيسي (space-y-5)
    │   ├── Card: العميل والدفع
    │   ├── Card: بيانات الفاتورة (تاريخ/شروط/استحقاق/مركز/مسؤول)
    │   ├── Card: البنود (سطور قابلة للإضافة/الحذف)
    │   ├── Card: الخصم/الشحن/التسوية
    │   └── Card: الملاحظات
    └── <aside lg:sticky top-4>: الملخّص اللاصق (إجماليات + أزرار)
```

مطابق لنمط «المستند المالي» في `patterns/ux-patterns.md` §5: سطور (رئيسي) + **ملخّص لاصق** يحسب
لحظياً. وتخطيط عمود+قضيب من `layout/grid-system.md` (§قضبان جانبية).

## 2. رأس الشاشة (Header) — مطابق `layout/grid-system.md` §Layout Rules

- `flex flex-wrap items-center gap-3` (متجاوب) + `ms-auto` لمجموعة الأزرار.
- **زر رجوع** `ghost/icon` بأيقونة `ArrowRight` (RTL: يشير للعودة) + `aria-label` — `patterns/ux-patterns.md` §8.
- **تدرّج الأزرار الصحيح:** إلغاء (`ghost`) → حفظ كمسودة (`outline`) → حفظ وترحيل (`primary`).
  زر أساسي بارز **واحد** — `components/buttons.md`.

## 3. أقسام النموذج (Form Sections) — `components/forms.md`

كل قسم في `Card` بعنوان `CardTitle` يحمل أيقونة `text-primary` + نص:

| القسم | الأيقونة | المحتوى |
|---|---|---|
| العميل والدفع | Users | العميل (مطلوب) · نوع الدفع (نقدي/آجل) |
| بيانات الفاتورة | FileText | الرقم (تلقائي) · التاريخ · شروط الدفع (أيام) · الاستحقاق · مركز التكلفة · المسؤول |
| البنود | ShoppingCart | سطور المنتجات (جدول قابل للتحرير) |
| الخصم/الشحن | Tag | نوع الخصم · القيمة · الشحن · التسوية |
| الملاحظات | StickyNote | نصّ حرّ (textarea) |

- بنية الحقل الموحّدة: `<div space-y-1.5>` + `Label` (بنجمة `text-negative` للمطلوب) + حقل.
  مطابق `components/forms.md` §Field Anatomy.
- شبكات الحقول: `grid grid-cols-1 gap-3 sm:grid-cols-2 [lg:grid-cols-3/4]` — `layout/grid-system.md`.
- **الكشف التدريجي:** مركز التكلفة/المسؤول يظهران فقط إن وُجدت بياناتهما (`centers.length > 0`)
  — `patterns/ux-patterns.md` §10.

## 4. جدول البنود القابل للتحرير (Editable Line Items)

- **رؤوس أعمدة** `text-[11px] font-medium text-muted` تظهر `md:grid` فقط.
- كل سطر: `grid grid-cols-2 md:grid-cols-12 gap-2` — **بطاقة على الجوال** (`border rounded-lg p-2`)،
  صف شبكي على الديسكتوب (`md:border-0`). مطابق `layout/responsive.md` §1 (جدول→بطاقات).
- الحقول المالية للسطر: `Input` بـ `num text-end` + `inputMode="decimal"`.
- إجمالي السطر محسوب لحظياً (`num text-end`).
- زر حذف السطر `ghost/icon` بأيقونة `Trash2 text-negative` + `aria-label`؛ يمنع حذف آخر سطر.
- زر «إضافة سطر» `outline size="sm"` في رأس البطاقة.

## 5. الملخّص اللاصق (Sticky Summary) — قلب «المستند المالي»

- `<aside lg:sticky lg:top-4>` يبقى مرئياً أثناء التمرير — `patterns/ux-patterns.md` §5.
- صفوف: الإجمالي قبل الضريبة · الخصم (`text-positive` بإشارة `-`) · الشحن · الضريبة · التسوية.
- **الإجمالي النهائي:** `num text-2xl font-bold text-primary-hover` مفصول بحدّ علوي.
- أزرار الحفظ مكرّرة هنا (وصول أسرع أثناء التمرير) + تلميح «الإجماليات مشتقّة تلقائياً».

## 6. القاعدة المالية الحاكمة — `financial/financial-ui.md` §5

> **الإجماليات مشتقّة لا مُدخَلة.**

كل الإجماليات (`subMinor`, `taxMinor`, `totalMinor`) **محسوبة من السطور بالهللات** في العميل
كمعاينة، والخادم يعيد حسابها من السطور عند الترحيل (مصدر الحقيقة). المستخدم لا يكتب إجمالياً.

- **بلا float:** كل الحساب `intdiv`/`Math.floor`/`Math.round` على أعداد صحيحة (هللات) — `financial-ui.md` §1.
- **العرض من الهللات → ريال** عبر `formatRiyal(x / 100)` في طبقة العرض فقط.
- **السالب/الخصم** بإشارة + لون دلالي.

## 7. إدخال المال (Money Input) — `components/forms.md` §3

- الحقول المالية: `num text-end` + `inputMode="decimal"` + لاحقة (`﷼`/`%`/`يوم`) عبر
  `span absolute end-3` (خصيصة منطقية RTL).
- التحويل بـ `riyalToMinor` قبل الإرسال؛ **المدخل المشوّه (NaN) يُرفض** لا يُحوَّل 0 صمتاً
  (`financial-ui.md` §1) — `if (…!Number.isFinite(riyalToMinor(l.price))) setError(…)`.
- كمية فارغة/صفر = سطر **مستبعَد** (لا يُفوتَر بكمية 1 خفيةً) — اتّساق المعاينة مع الإرسال.

## 8. الحالات (States) — `patterns/states.md`

| الحالة | التنفيذ |
|---|---|
| **Loading** | جلب القوائم (عملاء/منتجات/مراكز/موظفين) في `useEffect` مع `.catch(()=>{})` للاختيارية |
| **Validation** | لا سطر صالح → `setError(t('need_line'))`؛ مدخل مشوّه → `saveFailed` |
| **Error (إرسال)** | شريط `rounded bg-negative/10 px-3 py-2 text-xs text-negative` داخل الملخّص + `ApiError.message` |
| **Success** | `success` Toast + توجيه لصفحة التفاصيل `/invoices/{id}` |
| **Saving** | `disabled={!canSave}` (يشمل `saving`) على كل أزرار الحفظ — منع الإرسال المزدوج |

## 9. RTL · i18n · a11y

- خصائص منطقية فقط: `ms-auto`, `pe-12/pe-14`, `end-3`, `text-end`, `border-t`. لا `left/right`.
- الحقول اللاتينية (تاريخ/رقم) `dir="ltr"`.
- كل النصوص من `useTranslations('invoiceForm')` — لا نصّ مكتوب.
- `aria-label` على أزرار الأيقونات (رجوع، حذف سطر)؛ `Label htmlFor` لكل حقل؛ حلقة تركيز مضمّنة.

## 10. رصد المطابقة (Compliance) — **يجتاز ✅**

| المعيار | النتيجة |
|---|---|
| رموز فقط (لا hex/ألوان خام) | ✅ |
| خطّان + `.num` للأرقام | ✅ |
| خصائص منطقية RTL | ✅ |
| زر أساسي واحد + تدرّج صحيح | ✅ |
| أقسام في Cards + بنية حقل موحّدة | ✅ |
| الإجماليات مشتقّة، بلا float، هللات | ✅ (نموذجي) |
| حالات: تحقّق/خطأ/نجاح/حفظ | ✅ |
| منع الإرسال المزدوج | ✅ (`disabled`) |
| استجابة (سطور → بطاقات) + ملخّص لاصق | ✅ |
| i18n كامل + a11y | ✅ |

**ملاحظات دقيقة (غير مُلزِمة):**
- بعض الحاويات تستخدم `rounded-md`/`h-10` (حقل الرقم التلقائي، textarea) بدل `rounded`/`h-9`
  القياسيين — فرق طفيف مقبول ضمن نطاق النموذج؛ يُفضَّل التوحيد على `rounded`/`h-9` مستقبلاً.
- الـ textarea منسّق يدوياً (لا مكوّن `Textarea` موحّد) — مرشّح لمكوّن `ui/textarea.tsx` مستقبلاً
  (يُضاف للمكوّنات عند تكراره — `components/README.md`).

## 11. الخلاصة (اختبار DS)

- **وُثِّقت الشاشة بالكامل من قواعد DS دون أي سؤال** → النظام مكتمل عند هذا النمط أيضاً.
- هذه الشاشة **القالب المعياري لأي مستند مالي** (فاتورة/عرض سعر/سند/مرتجع): سطور + ملخّص لاصق +
  إجماليات مشتقّة + هللات + حالات كاملة.
- المكوّنان المرشّحان للتوحيد (`Textarea`، توحيد `h-9/rounded`) مسجّلان كتحسينات لا انحرافات.

## مرجع سريع
- نمط القائمة: `examples/invoices-screen.md`.
- الوصفات العامة: `examples/recipes.md`.
- قواعد المال: `financial/financial-ui.md`.
