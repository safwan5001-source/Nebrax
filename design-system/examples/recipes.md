# وصفات جاهزة (Examples & Recipes)

انسخ ووصّل. هذه الوصفات تنتج شاشة بجودة بقية النظام.

## قائمة فحص شاشة جديدة (New Screen Checklist)

- [ ] رموز الألوان فقط (لا hex/ألوان Tailwind خام).
- [ ] خطّان؛ الأرقام بـ `.num` محاذاة يمين + السالب أحمر وإشارة.
- [ ] خصائص منطقية RTL (لا `left/right`).
- [ ] رأس موحّد: عنوان `text-xl font-semibold` + أزرار `ms-auto`.
- [ ] التجميع في `Card` بعنوان `CardTitle`.
- [ ] القوائم عبر `DataTable` (+ `exportName`).
- [ ] الحالات الثلاث: تحميل (Skeleton) · فارغ (`emptyLabel`) · خطأ.
- [ ] كل عنصر تفاعلي: حلقة تركيز + `aria-label` عند اللزوم.
- [ ] يعمل على الجوال (جدول → بطاقات).
- [ ] i18n: مفاتيح ar/en متطابقة (لا نصّ مكتوب).
- [ ] `npm run build` ينجح.

## وصفة 1 — شاشة قائمة

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

export default function ItemsPage() {
  const t = useTranslations('items');
  const [rows, setRows] = useState([]); const [loading, setLoading] = useState(true);
  useEffect(() => { api('/items').then((r) => setRows(r.data)).finally(() => setLoading(false)); }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <Button className="ms-auto"><Plus className="h-4 w-4" strokeWidth={1.8} />{t('add')}</Button>
      </div>
      <DataTable
        columns={columns} data={rows} loading={loading}
        searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="items"
      />
    </div>
  );
}
```

## وصفة 2 — حقل نموذج

```tsx
<div className="space-y-1.5">
  <Label htmlFor="name">{t('name')} <span className="text-negative">*</span></Label>
  <Input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} />
  {error && <p className="text-xs text-negative">{error}</p>}
</div>
```

## وصفة 3 — عمود مالي في جدول

```tsx
{ accessorKey: 'total', header: t('total'),
  cell: ({ row }) => <span className="num">{formatRiyal(row.original.total)}</span> }
```

## وصفة 4 — بطاقة مؤشّر (KPI)

```tsx
<Card>
  <CardHeader><CardTitle>{t('revenue')}</CardTitle></CardHeader>
  <CardContent>
    <p className="num text-2xl font-semibold text-text">{formatRiyal(value)}</p>
    <p className="text-xs text-muted">{t('this_month')}</p>
  </CardContent>
</Card>
```

## وصفة 5 — الحالات الثلاث

```tsx
{loading
  ? <Skeleton className="h-40 w-full" />
  : error
    ? <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>
    : rows.length === 0
      ? <p className="py-8 text-center text-muted">{t('empty')}</p>
      : <DataTable … />}
```
