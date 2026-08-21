'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
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
import { type EmployeeRequest } from '@/components/hr/employee-request-dialog';

interface RequestType {
  id: string;
  name: string;
  requires_approval: boolean;
  is_active: boolean;
  employee_requests_count: number;
}

const statusTone: Record<EmployeeRequest['status'], 'positive' | 'warning' | 'muted' | 'negative'> = {
  approved: 'positive', pending: 'warning', rejected: 'negative', cancelled: 'muted',
};

/**
 * إدارة الطلبات — نطاق البناء الأول (design-system/foundations/
 * hr-users-architecture.md «إدارة الطلبات»): أنواع طلبات ثابتة (كيانٌ مُدار)
 * + طابور موافقة عبر كل الموظفين، بحقولٍ موحّدة — لا محرّك حقول ديناميكية.
 * منفصلةٌ عمداً عن `LeaveManager` (طلبات الإجازة وحدةٌ مستقلة).
 */
export function RequestsManager() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const { success, error: toastError } = useToast();

  const [sub, setSub] = useState<'requests' | 'types'>('requests');

  // أنواع الطلبات
  const [types, setTypes] = useState<RequestType[]>([]);
  const [typesLoading, setTypesLoading] = useState(true);
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState<RequestType | null>(null);
  const [typeForm, setTypeForm] = useState({ name: '', requires_approval: true, is_active: true });
  const [typeError, setTypeError] = useState<string | null>(null);
  const [typeSaving, setTypeSaving] = useState(false);

  const loadTypes = useCallback(() => {
    setTypesLoading(true);
    api<{ data: RequestType[] }>('/request-types').then((r) => setTypes(r.data)).catch(() => {}).finally(() => setTypesLoading(false));
  }, []);
  useEffect(() => { if (sub === 'types') loadTypes(); }, [sub, loadTypes]);

  function openCreateType() {
    setEditingType(null);
    setTypeForm({ name: '', requires_approval: true, is_active: true });
    setTypeError(null);
    setTypeDialogOpen(true);
  }
  function openEditType(rt: RequestType) {
    setEditingType(rt);
    setTypeForm({ name: rt.name, requires_approval: rt.requires_approval, is_active: rt.is_active });
    setTypeError(null);
    setTypeDialogOpen(true);
  }
  async function saveType() {
    if (!typeForm.name.trim()) {
      setTypeError(t('org_name_required'));
      return;
    }
    setTypeSaving(true);
    setTypeError(null);
    try {
      const body = { name: typeForm.name.trim(), requires_approval: typeForm.requires_approval, is_active: typeForm.is_active };
      if (editingType) {
        await api(`/request-types/${editingType.id}`, { method: 'PUT', body });
      } else {
        await api('/request-types', { method: 'POST', body });
      }
      success(editingType ? tc('updated') : tc('created'));
      setTypeDialogOpen(false);
      loadTypes();
    } catch (err) {
      setTypeError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setTypeSaving(false);
    }
  }
  async function removeType(rt: RequestType) {
    if (!window.confirm(t('confirm_delete_request_type', { name: rt.name }))) return;
    try {
      await api(`/request-types/${rt.id}`, { method: 'DELETE' });
      success(tc('deleted'));
      loadTypes();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    }
  }

  const typeColumns: ColumnDef<RequestType, unknown>[] = [
    { accessorKey: 'name', header: t('org_name') },
    { id: 'requires_approval', header: t('leave_requires_approval'), cell: ({ row }) => <Badge tone={row.original.requires_approval ? 'warning' : 'muted'}>{row.original.requires_approval ? tc('yes') : tc('no')}</Badge> },
    { accessorKey: 'is_active', header: t('status_label'), cell: ({ row }) => <Badge tone={row.original.is_active ? 'positive' : 'muted'}>{row.original.is_active ? t('active') : t('inactive')}</Badge> },
    {
      id: 'actions', header: '',
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" aria-label={t('edit')} onClick={() => openEditType(row.original)}>
            <Pencil className="h-4 w-4" strokeWidth={1.7} />
          </Button>
          <Button variant="ghost" size="icon" aria-label={t('delete')} onClick={() => removeType(row.original)}>
            <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
          </Button>
        </div>
      ),
    },
  ];

  // طابور الطلبات
  const [requests, setRequests] = useState<EmployeeRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | EmployeeRequest['status']>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadRequests = useCallback(() => {
    setRequestsLoading(true);
    const query = statusFilter === 'all' ? '' : `?status=${statusFilter}`;
    api<{ data: EmployeeRequest[] }>(`/requests${query}`).then((r) => setRequests(r.data)).catch(() => {}).finally(() => setRequestsLoading(false));
  }, [statusFilter]);
  useEffect(() => { if (sub === 'requests') loadRequests(); }, [sub, loadRequests]);

  async function approve(r: EmployeeRequest) {
    setBusyId(r.id);
    try {
      await api(`/requests/${r.id}/approve`, { method: 'POST' });
      success(t('leave_approved'));
      loadRequests();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setBusyId(null);
    }
  }
  async function reject(r: EmployeeRequest) {
    setBusyId(r.id);
    try {
      await api(`/requests/${r.id}/reject`, { method: 'POST' });
      success(t('leave_rejected'));
      loadRequests();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setBusyId(null);
    }
  }

  const requestColumns: ColumnDef<EmployeeRequest, unknown>[] = [
    { id: 'employee', header: t('employee'), accessorFn: (r) => r.employee?.name ?? '', cell: ({ row }) => row.original.employee?.name ?? '—' },
    { id: 'request_type', header: t('request_type'), cell: ({ row }) => row.original.request_type?.name ?? '—' },
    { accessorKey: 'title', header: t('request_title') },
    { accessorKey: 'requested_date', header: t('requested_date'), cell: ({ row }) => <span className="num text-muted" dir="ltr">{row.original.requested_date ?? '—'}</span> },
    { accessorKey: 'status', header: t('status_label'), cell: ({ row }) => <Badge tone={statusTone[row.original.status]}>{t(`leave_status_${row.original.status}`)}</Badge> },
    {
      id: 'actions', header: '',
      cell: ({ row }) => row.original.status === 'pending' ? (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" aria-label={t('leave_approve')} disabled={busyId === row.original.id} onClick={() => approve(row.original)}>
            <Check className="h-4 w-4 text-positive" strokeWidth={2} />
          </Button>
          <Button variant="ghost" size="icon" aria-label={t('leave_reject')} disabled={busyId === row.original.id} onClick={() => reject(row.original)}>
            <X className="h-4 w-4 text-negative" strokeWidth={2} />
          </Button>
        </div>
      ) : null,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 overflow-x-auto">
          {(['requests', 'types'] as const).map((key) => (
            <button
              key={key}
              onClick={() => setSub(key)}
              className={cn(
                'whitespace-nowrap rounded px-3 py-1.5 text-sm',
                sub === key ? 'bg-primary-soft font-medium text-primary' : 'text-muted hover:text-text'
              )}
            >
              {key === 'requests' ? t('requests_queue') : t('request_types')}
            </button>
          ))}
        </div>
        {sub === 'types' && (
          <Button size="sm" onClick={openCreateType}>
            <Plus className="h-4 w-4" strokeWidth={1.8} />
            {t('add_request_type')}
          </Button>
        )}
      </div>

      {sub === 'requests' && (
        <>
          <div className="flex gap-1 overflow-x-auto">
            {(['pending', 'approved', 'rejected', 'all'] as const).map((key) => (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={cn(
                  'whitespace-nowrap rounded-full border px-3 py-1 text-xs',
                  statusFilter === key ? 'border-primary bg-primary-soft text-primary' : 'border-border text-muted hover:text-text'
                )}
              >
                {key === 'all' ? tc('all') : t(`leave_status_${key}`)}
              </button>
            ))}
          </div>
          <DataTable
            columns={requestColumns}
            data={requests}
            loading={requestsLoading}
            searchPlaceholder={t('search_requests')}
            emptyLabel={t('no_requests')}
            exportName="requests"
          />
        </>
      )}

      {sub === 'types' && (
        <DataTable
          columns={typeColumns}
          data={types}
          loading={typesLoading}
          searchPlaceholder={t('search_org_items')}
          emptyLabel={t('no_org_items')}
          exportName="request-types"
        />
      )}

      <Dialog open={typeDialogOpen} onClose={() => setTypeDialogOpen(false)} title={editingType ? t('edit_request_type') : t('add_request_type')}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rt-name">{t('org_name')}</Label>
            <Input id="rt-name" value={typeForm.name} onChange={(e) => setTypeForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="rt-approval">{t('leave_requires_approval')}</Label>
            <Switch id="rt-approval" checked={typeForm.requires_approval} onCheckedChange={(v) => setTypeForm((f) => ({ ...f, requires_approval: v }))} aria-label={t('leave_requires_approval')} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="rt-active">{t('status_label')}</Label>
            <Switch id="rt-active" checked={typeForm.is_active} onCheckedChange={(v) => setTypeForm((f) => ({ ...f, is_active: v }))} aria-label={t('status_label')} />
          </div>
          {typeError && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{typeError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setTypeDialogOpen(false)}>{t('cancel')}</Button>
            <Button disabled={typeSaving} onClick={saveType}>{t('save')}</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
