# Badge · Card · Table · DataTable

## Badge (`ui/badge.tsx`)

`rounded px-2 py-0.5 text-xs font-medium`. **tone:**

| tone | الأصناف | الاستخدام |
|---|---|---|
| `neutral` (افتراضي) | `bg-primary-soft text-primary` | وسم عام/محايد |
| `muted` | `border border-border text-muted` | ثانوي/تصنيف |
| `positive` | `bg-positive/10 text-positive` | مسدّدة/مرحّلة/دائن |
| `warning` | `bg-warning/10 text-warning` | متأخّر/معلّق |
| `negative` | `bg-negative/10 text-negative` | ملغاة/متجاوز |

قاعدة: حالة المستند تُعرَض كـ Badge. اقرن اللون بنصّ واضح (لا لون وحده).

## Card (`ui/card.tsx`)

`rounded border border-border bg-surface` — **بلا ظل** (فصل بالحدّ).
- `CardHeader` `p-4 pb-2` · `CardTitle` `text-sm font-medium text-muted` · `CardContent` `p-4 pt-2`.
- وحدة التجميع الأساسية: كل قسم/مجموعة حقول في بطاقة بعنوان.

## Table (بدائيات — `ui/table.tsx`)

- الغلاف `overflow-x-auto` (تمرير أفقي داخلي).
- `text-sm`، رأس `border-b text-muted`، صف `border-b last:border-0 hover:bg-primary-soft/40`.
- `TH` `px-3 py-2 text-start font-medium`، `TD` `px-3 py-2`.
- الأرقام: خلية `className="num text-end"`.

## DataTable (`data-table.tsx`) — المواصفة الكاملة

المكوّن البطل. مبني على **TanStack Table**. الخصائص: `columns`, `data`, `loading`,
`searchPlaceholder`, `emptyLabel`, `exportName`.

### القدرات (مُنفَّذة)
- **فرز** (`getSortedRowModel`) — نقر رأس العمود.
- **بحث عام** (`globalFilter` + `getFilteredRowModel`) — حقل بحث أعلى الجدول.
- **تصدير CSV** (`exportCsv` → `toCsv`/`downloadCsv`) — متوافق مع Excel (BOM UTF-8).
- **حالة تحميل:** Skeleton.
- **حالة فارغة:** `emptyLabel`.
- **استجابة:** جدول `hidden md:block` ↔ قائمة بطاقات `md:hidden` (صف = بطاقة).

### القدرات الناقصة (مقترحة — انظر recommended-improvements)
- ترقيم صفحات (pagination) — غير مُنفَّذ.
- فلاتر أعمدة، تحديد صفوف، تثبيت رأس (sticky header)، تصدير PDF.

### قواعد الاستخدام
1. كل شاشة قائمة تستخدم `DataTable` (لا جدول يدوي) لتوحيد البحث/الفرز/التصدير/الحالات.
2. الأعمدة المالية: `cell` بـ `.num text-end` + `formatRiyal`.
3. الحالة كعمود Badge.
4. أول عمود (الاسم/الرقم) رابط `text-primary` لصفحة التفاصيل.
5. مرّر `exportName` دائماً لتفعيل التصدير.

### مثال عمود
```tsx
{ accessorKey: 'total', header: t('total'),
  cell: ({ row }) => <span className="num">{formatRiyal(row.original.total)}</span> }
```
