# Forms · Inputs · Select · Label

المصادر: `ui/input.tsx`, `ui/select.tsx`, `ui/label.tsx`. منطق: **react-hook-form + zod**.

## Input (`ui/input.tsx`)

Anatomy: `h-9 w-full rounded border border-border bg-surface px-3 text-sm text-text placeholder:text-muted`
+ `focus-visible:ring-2 focus-visible:ring-primary/40`.

- **دعم `className`** لتمديد (مثل `h-11 text-base` في المصادقة، `num text-end` للأرقام).
- الحقول اللاتينية (بريد/هاتف/كود/رقم): `dir="ltr"`.
- الأرقام المالية: `inputMode="decimal"` + `className="num text-end"` + `placeholder="0.00"`.

## Select (`ui/select.tsx`)

`h-9 w-full rounded border border-border bg-surface px-2 text-sm` + نفس حلقة التركيز.
`<option>` عادية. للقوائم الطويلة القابلة للبحث → (مقترح) Combobox مستقبلي.

## Label (`ui/label.tsx`)

`text-sm font-medium text-text`. تُربَط بالحقل عبر `htmlFor` = `id` الحقل.

## بنية الحقل الموحّدة (Field Anatomy)

```tsx
<div className="space-y-1.5">
  <Label htmlFor="name">الاسم <span className="text-negative">*</span></Label>
  <Input id="name" value={v} onChange={…} />
  {error && <p className="text-xs text-negative">{error}</p>}
</div>
```
- المطلوب يُعلَّم بنجمة `text-negative`.
- رسالة الخطأ: `text-xs text-negative` أسفل الحقل.
- تلميح مساعد: `text-[11px] text-muted`.

## تخطيط النماذج

- حقول متجاورة: `grid grid-cols-1 gap-3 sm:grid-cols-2`.
- إيقاع رأسي: `space-y-3`/`space-y-4`.
- أقسام النموذج في `Card` بعنوان `CardTitle` (مثل «بيانات العميل» / «بيانات الحساب»).
- أزرار الإجراء: أساسي (حفظ) + `outline` (إلغاء)، في رأس الشاشة أو أسفل النموذج.

## قواعد النماذج (Form Guidelines)

1. **تحقّق عميل + خادم:** zod على العميل، وقواعد `FormRequest` على الخادم (لا تعتمد على العميل وحده).
2. **الإجماليات مشتقّة لا مُدخَلة:** الحقول المالية الإجمالية تُحسب من السطور، لا يكتبها المستخدم.
3. **المال بالهللات:** حوّل مدخل الريال بـ `riyalToMinor` قبل الإرسال؛ ارفض المدخل المشوّه (NaN) بدل إرساله 0.
4. **منع الإرسال المزدوج:** `disabled={isSubmitting}` على زر الحفظ.
5. **رسائل الخطأ قرب الحقل**، وخطأ الخادم أعلى النموذج في شريط `bg-negative/10`.
6. **تعطيل التحرير بعد الترحيل:** المستندات المرحّلة للقراءة فقط (تصحيح بقيد عكسي).
7. **`key` لإعادة تركيب الحوارات** عند تغيّر السجل المُحرَّر (تفادي كتابة فراغات فوق البيانات).

## States

- **error:** حدّ/رسالة `negative`.
- **disabled:** `disabled:opacity-50`.
- **focus:** حلقة `ring-primary/40` (مضمّنة).
