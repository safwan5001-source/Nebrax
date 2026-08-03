# المكوّنات (Components) — الإطار

كل مكوّن يُوثَّق بإطار موحّد: **Anatomy · Variants · Sizes · States · Usage · Do/Don't**.

## اتفاقيات البناء (shadcn/ui-style)

- **CVA** (`class-variance-authority`) لتعريف المتغيّرات والأحجام (كما في `button.tsx`, `badge.tsx`).
- **`cn()`** (من `@/lib/utils`) لدمج الأصناف مع تجاوز `className` الوارد.
- **`React.forwardRef`** لكل مكوّن يغلّف عنصر HTML (input, button, label…).
- **`'use client'`** فقط للمكوّنات التفاعلية (state/effect/context).
- الأصناف الأساسية داخل المكوّن؛ التخصيص عبر `className` prop (يُدمَج بـ `cn`، لا يُستبدَل).
- خصائص منطقية RTL في كل الأصناف.

## تشريح موحّد (Anatomy Pattern)

```
[أيقونة اختيارية] + [محتوى/نص] + [إجراء/حالة اختيارية]
```
- الأيقونات lucide-react، `strokeWidth` 1.6–1.8، حجم متناسق (`h-4 w-4` عادةً).
- الفجوة الداخلية `gap-2` نموذجياً.

## حالات موحّدة (States) — تنطبق على كل عنصر تفاعلي

| الحالة | التطبيق |
|---|---|
| **default** | اللون/الحدّ الأساسي |
| **hover** | `hover:bg-primary-soft` (شبح) / `hover:bg-primary-hover` (أساسي) — `transition-colors` |
| **focus-visible** | `focus-visible:ring-2 focus-visible:ring-primary/40 outline-none` (إلزامي) |
| **active/selected** | `bg-primary-soft text-primary` + مؤشر (خطّ جانبي في الشريط) |
| **disabled** | `disabled:opacity-50 disabled:pointer-events-none` |
| **loading** | زر: `disabled` + مؤشر؛ منطقة: Skeleton |
| **error** | حدّ/نص `negative` + رسالة `text-xs text-negative` |

## فهرس المكوّنات

| المكوّن | الملف | المصدر |
|---|---|---|
| Button | `buttons.md` | `ui/button.tsx` |
| Input · Select · Label · Forms | `forms.md` | `ui/{input,select,label}.tsx` |
| Badge · Card · Table · DataTable | `data-display.md` | `ui/{badge,card,table}.tsx`, `data-table.tsx` |
| Dialog · Toast · Skeleton | `overlays.md` | `ui/{dialog,toast,skeleton}.tsx` |
| Sidebar · Topbar · Command Palette | `navigation.md` | `layout/{sidebar,topbar}.tsx` (+ لوحة أوامر مقترحة) |

## قاعدة إنشاء مكوّن جديد

1. هل يوجد مكوّن يفي؟ استخدمه/وسّعه. لا تكرّر.
2. اتبع نمط CVA + forwardRef + cn.
3. رموز فقط (لا hex/ألوان خام).
4. غطِّ الحالات الست أعلاه.
5. خصائص منطقية RTL + `aria-*` + حلقة تركيز.
6. وثّقه هنا بنفس الإطار.
