# Button

المصدر: `web/src/components/ui/button.tsx` (CVA). **مُنفَّذ (v1.0).**

## Anatomy

```
[أيقونة؟] [نص] [أيقونة؟]   داخل: inline-flex items-center justify-center gap-2 rounded
```

## Variants

| variant | الأصناف | الاستخدام |
|---|---|---|
| `primary` (افتراضي) | `bg-primary text-white hover:bg-primary-hover` | الإجراء الأساسي (حفظ، إنشاء) — **واحد فقط لكل شاشة/قسم** |
| `outline` | `border border-border bg-surface text-text hover:bg-primary-soft` | إجراء ثانوي (إلغاء، تصدير) |
| `ghost` | `text-text hover:bg-primary-soft` | إجراءات خفيفة/أيقونية (رأس، جدول) |
| `danger` | `bg-negative text-white hover:opacity-90` | فعل هدّام مؤكَّد (حذف) — نادر، مع تأكيد |

## Sizes

| size | الأصناف | الاستخدام |
|---|---|---|
| `sm` | `h-8 px-3` | أشرطة أدوات مضغوطة |
| `md` (افتراضي) | `h-9 px-4` | الافتراضي |
| `icon` | `h-9 w-9` | زر أيقونة فقط (يتطلّب `aria-label`) |

> شاشات المصادقة تستخدم `className="h-11 w-full text-base"` (أهداف لمس أكبر) — استثناء موثّق.

## States

- **base:** `text-sm font-medium transition-colors`.
- **focus:** `focus-visible:ring-2 focus-visible:ring-primary/40` (مضمّن).
- **disabled:** `disabled:opacity-50 disabled:pointer-events-none` (مضمّن).
- **loading:** مرّر `disabled={saving}`؛ (مقترح) أضف مؤشر Loader2 دوّار داخل الزر.

## Usage

```tsx
<Button onClick={save} disabled={saving}>حفظ</Button>
<Button variant="outline" onClick={cancel}>إلغاء</Button>
<Button variant="ghost" size="icon" aria-label="تعديل"><Pencil className="h-4 w-4" strokeWidth={1.7}/></Button>
```

## Do / Don't

- ✅ زر أساسي **واحد** بارز لكل سياق؛ البقية `outline`/`ghost`.
- ✅ زر الأيقونة يحمل `aria-label` دائماً.
- ✅ عطّل الزر أثناء الإرسال (`disabled={saving}`) لمنع الإرسال المزدوج.
- ❌ لا تستخدم `danger` لغير الأفعال الهدّامة.
- ❌ لا لون خام؛ الأزرار كلها `primary/negative` عبر الرمز.
- ❌ لا تضع أكثر من زر أساسي بارز واحد متجاورين.
