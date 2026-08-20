'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

interface OrgItem {
  id: string;
  name: string;
  is_active: boolean;
  employees_count: number;
}

const ENDPOINTS = ['job-titles', 'departments', 'job-levels', 'employment-types'] as const;
type Endpoint = (typeof ENDPOINTS)[number];

/**
 * الهيكل التنظيمي: مسمى وظيفي/قسم/مستوى وظيفي/نوع توظيف — أربعة كيانات
 * مُدارة متطابقة السلوك، فتُدار بمكوّنٍ واحد يتبدّل مصدره حسب القسم النشط
 * بدل أربعة شاشات شبه متطابقة (design-system/foundations/hr-users-architecture.md).
 */
export function OrgStructureManager() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const { success, error: toastError } = useToast();

  const [active, setActive] = useState<Endpoint>('job-titles');
  const [items, setItems] = useState<Record<Endpoint, OrgItem[]>>({
    'job-titles': [], departments: [], 'job-levels': [], 'employment-types': [],
  });
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<OrgItem | null>(null);
  const [name, setName] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((endpoint: Endpoint) => {
    setLoading(true);
    api<{ data: OrgItem[] }>(`/${endpoint}`)
      .then((r) => setItems((prev) => ({ ...prev, [endpoint]: r.data })))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(active), [active, load]);

  const sectionLabel: Record<Endpoint, string> = {
    'job-titles': t('job_titles'),
    departments: t('departments'),
    'job-levels': t('job_levels'),
    'employment-types': t('employment_types'),
  };
  const addLabel: Record<Endpoint, string> = {
    'job-titles': t('add_job_title'),
    departments: t('add_department'),
    'job-levels': t('add_job_level'),
    'employment-types': t('add_employment_type'),
  };

  function openCreate() {
    setEditing(null);
    setName('');
    setIsActive(true);
    setError(null);
    setDialogOpen(true);
  }

  function openEdit(item: OrgItem) {
    setEditing(item);
    setName(item.name);
    setIsActive(item.is_active);
    setError(null);
    setDialogOpen(true);
  }

  async function save() {
    if (!name.trim()) {
      setError(t('org_name_required'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = { name: name.trim(), is_active: isActive };
      if (editing) {
        await api(`/${active}/${editing.id}`, { method: 'PUT', body });
      } else {
        await api(`/${active}`, { method: 'POST', body });
      }
      success(editing ? tc('updated') : tc('created'));
      setDialogOpen(false);
      load(active);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: OrgItem) {
    if (!window.confirm(t('confirm_delete_org_item', { name: item.name }))) return;
    try {
      await api(`/${active}/${item.id}`, { method: 'DELETE' });
      success(tc('deleted'));
      load(active);
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    }
  }

  const columns: ColumnDef<OrgItem, unknown>[] = [
    { accessorKey: 'name', header: t('org_name') },
    { accessorKey: 'employees_count', header: t('org_employees_count'), cell: ({ row }) => <span className="num text-muted">{row.original.employees_count}</span> },
    {
      accessorKey: 'is_active',
      header: t('status_label'),
      cell: ({ row }) => <Badge tone={row.original.is_active ? 'positive' : 'muted'}>{row.original.is_active ? t('active') : t('inactive')}</Badge>,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" aria-label={t('edit')} onClick={() => openEdit(row.original)}>
            <Pencil className="h-4 w-4" strokeWidth={1.7} />
          </Button>
          <Button variant="ghost" size="icon" aria-label={t('delete')} onClick={() => remove(row.original)}>
            <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 overflow-x-auto">
          {ENDPOINTS.map((key) => (
            <button
              key={key}
              onClick={() => setActive(key)}
              className={cn(
                'whitespace-nowrap rounded px-3 py-1.5 text-sm',
                active === key ? 'bg-primary-soft font-medium text-primary' : 'text-muted hover:text-text'
              )}
            >
              {sectionLabel[key]}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" strokeWidth={1.8} />
          {addLabel[active]}
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={items[active]}
        loading={loading}
        searchPlaceholder={t('search_org_items')}
        emptyLabel={t('no_org_items')}
        exportName={active}
      />

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? t('edit_org_item') : addLabel[active]}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="org-name">{t('org_name')}</Label>
            <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="org-active">{t('status_label')}</Label>
            <Switch id="org-active" checked={isActive} onCheckedChange={setIsActive} aria-label={t('status_label')} />
          </div>
          {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t('cancel')}</Button>
            <Button disabled={saving} onClick={save}>{t('save')}</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
