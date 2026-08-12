'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { SettingsHeader } from '@/components/inventory-settings/settings-header';
import { api, ApiError } from '@/lib/api';

interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  is_active: boolean;
  products_count?: number;
}

/** صفّ معروض: التصنيف ومستواه في الشجرة (يُحسب عند العرض لا يُخزَّن). */
interface Node extends Category { depth: number }

/**
 * تصنيفات المنتجات — شجرة متعدّدة المستويات.
 *
 * الـ API يُعيد قائمة مسطّحة بـ `parent_id`؛ الشجرة تُبنى هنا. استعلامٌ شجريّ
 * في القاعدة كان سيدفع ثمناً بلا مقابل: القائمة كلّها تُجلَب في كل الأحوال.
 */
export default function ProductCategoriesPage() {
  const t = useTranslations('inventorySettings');
  const tc = useTranslations('common');
  const { success } = useToast();

  const [rows, setRows] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [editing, setEditing] = useState<Category | null>(null);

  const load = useCallback(() => {
    api<{ data: Category[] }>('/product-categories')
      .then((r) => setRows(r.data))
      .catch(() => setRows([]));
  }, []);

  useEffect(() => load(), [load]);

  /** ترتيب العرض: كل أب يتبعه فروعه مباشرةً، بعمق يُترجَم إلى إزاحة. */
  const tree = useMemo<Node[]>(() => {
    if (!rows) return [];
    const byParent = new Map<string | null, Category[]>();
    for (const row of rows) {
      const key = row.parent_id;
      byParent.set(key, [...(byParent.get(key) ?? []), row]);
    }

    const out: Node[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const row of byParent.get(parent) ?? []) {
        out.push({ ...row, depth });
        walk(row.id, depth + 1);
      }
    };
    walk(null, 0);

    // احتياط: صفّ أبوه مفقود (بيانات قديمة) يظهر جذراً بدل أن يختفي صامتاً.
    if (out.length < rows.length) {
      const seen = new Set(out.map((r) => r.id));
      for (const row of rows) if (!seen.has(row.id)) out.push({ ...row, depth: 0 });
    }
    return out;
  }, [rows]);

  /** الأب المرشَّح: أي تصنيف عدا المحرَّر نفسه (منع الدورة يُحسم في الخادم أيضاً). */
  const parentOptions = useMemo(
    () => tree.filter((r) => !editing || r.id !== editing.id),
    [tree, editing]
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const body = { name: name.trim(), parent_id: parentId || null };
      if (editing) {
        await api(`/product-categories/${editing.id}`, { method: 'PUT', body });
      } else {
        await api('/product-categories', { method: 'POST', body });
      }
      success(tc('updated'));
      reset();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: Category) {
    setError(null);
    try {
      await api(`/product-categories/${row.id}`, { method: 'DELETE' });
      success(tc('updated'));
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    }
  }

  function edit(row: Category) {
    setEditing(row);
    setName(row.name);
    setParentId(row.parent_id ?? '');
  }

  function reset() {
    setEditing(null);
    setName('');
    setParentId('');
  }

  return (
    <div className="space-y-5">
      <SettingsHeader title={t('c_categories_t')} subtitle={t('c_categories_d')} />

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>{editing ? t('cat_edit') : t('cat_new')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cat-name">{t('cat_name')}</Label>
                <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={255} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cat-parent">{t('cat_parent')}</Label>
                <Select id="cat-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                  <option value="">{t('cat_no_parent')}</option>
                  {parentOptions.map((row) => (
                    <option key={row.id} value={row.id}>
                      {'— '.repeat(row.depth) + row.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

            <div className="flex justify-end gap-2">
              {editing && (
                <Button type="button" variant="outline" onClick={reset}>
                  <X className="h-4 w-4" strokeWidth={1.7} />
                  {t('cancel')}
                </Button>
              )}
              <Button type="submit" disabled={busy || !name.trim()}>
                {editing ? <Check className="h-4 w-4" strokeWidth={1.7} /> : <Plus className="h-4 w-4" strokeWidth={1.7} />}
                {editing ? t('cat_save') : t('cat_add')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="max-w-3xl">
        <CardHeader><CardTitle>{t('cat_list')}</CardTitle></CardHeader>
        <CardContent>
          {!rows ? (
            <Skeleton className="h-32 w-full" />
          ) : tree.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">{t('cat_empty')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {tree.map((row) => (
                <li key={row.id} className="flex items-center gap-3 py-2.5">
                  {/* الإزاحة تمثّل العمق — تسير مع اتجاه الصفحة تلقائياً. */}
                  <span className="min-w-0 flex-1 truncate text-sm text-text" style={{ paddingInlineStart: row.depth * 20 }}>
                    {row.name}
                  </span>
                  {!!row.products_count && (
                    <Badge tone="muted">{t('cat_products', { count: row.products_count })}</Badge>
                  )}
                  <Button variant="ghost" size="icon" aria-label={t('cat_edit')} onClick={() => edit(row)}>
                    <Pencil className="h-4 w-4" strokeWidth={1.7} />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={t('delete')} onClick={() => remove(row)}>
                    <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
