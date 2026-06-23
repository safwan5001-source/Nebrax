'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Pencil } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmployeeDialog, type Employee } from '@/components/hr/employee-dialog';
import { CreateRunDialog } from '@/components/hr/create-run-dialog';
import { RunDetailDialog, type PayrollRun } from '@/components/hr/run-detail-dialog';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { cn } from '@/lib/utils';

type Tab = 'employees' | 'runs';
const statusTone: Record<string, 'positive' | 'warning' | 'muted'> = { paid: 'positive', posted: 'warning', draft: 'muted' };

export default function HrPage() {
  const t = useTranslations('hr');
  const ts = useTranslations('status');
  const [tab, setTab] = useState<Tab>('employees');

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);

  const [empDialog, setEmpDialog] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [runDialog, setRunDialog] = useState(false);
  const [activeRun, setActiveRun] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api<{ data: Employee[] }>('/employees'), api<{ data: PayrollRun[] }>('/payroll-runs')])
      .then(([e, r]) => {
        setEmployees(e.data);
        setRuns(r.data);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  const empColumns = useMemo<ColumnDef<Employee, unknown>[]>(
    () => [
      { accessorKey: 'employee_no', header: t('employee_no'), cell: ({ row }) => <span className="num text-muted">{row.original.employee_no}</span> },
      { accessorKey: 'name', header: t('emp_name') },
      { accessorKey: 'job_title', header: t('job_title'), cell: ({ row }) => row.original.job_title ?? '—' },
      { accessorKey: 'basic_salary', header: t('basic_salary'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.basic_salary)}</div> },
      {
        id: 'gross',
        header: t('gross'),
        accessorFn: (r) => (r as Employee & { gross?: string }).gross ?? '0',
        cell: ({ row }) => <div className="num text-end font-medium">{formatRiyal((row.original as Employee & { gross?: string }).gross)}</div>,
      },
      {
        accessorKey: 'is_active',
        header: t('status_label'),
        cell: ({ row }) => <Badge tone={row.original.is_active ? 'positive' : 'muted'}>{row.original.is_active ? t('active') : t('inactive')}</Badge>,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Button variant="ghost" size="icon" aria-label={t('edit')} onClick={() => { setEditing(row.original); setEmpDialog(true); }}>
            <Pencil className="h-4 w-4" strokeWidth={1.7} />
          </Button>
        ),
      },
    ],
    [t]
  );

  const runColumns = useMemo<ColumnDef<PayrollRun, unknown>[]>(
    () => [
      {
        accessorKey: 'number',
        header: t('run_number'),
        cell: ({ row }) => (
          <button className="num text-primary hover:underline" onClick={() => setActiveRun(row.original.id)}>
            {row.original.number}
          </button>
        ),
      },
      { accessorKey: 'period', header: t('period'), cell: ({ row }) => <span className="num text-muted">{row.original.period}</span> },
      { accessorKey: 'total_net', header: t('total_net'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.total_net)}</div> },
      { accessorKey: 'status', header: t('status_label'), cell: ({ row }) => <Badge tone={statusTone[row.original.status] ?? 'muted'}>{ts(row.original.status)}</Badge> },
    ],
    [t, ts]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        {tab === 'employees' ? (
          <Button onClick={() => { setEditing(null); setEmpDialog(true); }}>
            <Plus className="h-4 w-4" strokeWidth={1.8} />
            {t('add_employee')}
          </Button>
        ) : (
          <Button onClick={() => setRunDialog(true)}>
            <Plus className="h-4 w-4" strokeWidth={1.8} />
            {t('create_run')}
          </Button>
        )}
      </div>

      <div className="flex gap-1 border-b border-border">
        {(['employees', 'runs'] as Tab[]).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'border-b-2 px-3 py-2 text-sm',
              tab === key ? 'border-primary font-medium text-primary' : 'border-transparent text-muted hover:text-text'
            )}
          >
            {t(key)}
          </button>
        ))}
      </div>

      {tab === 'employees' ? (
        <DataTable columns={empColumns} data={employees} loading={loading} searchPlaceholder={t('search_employees')} emptyLabel={t('no_employees')} exportName="employees" />
      ) : (
        <DataTable columns={runColumns} data={runs} loading={loading} searchPlaceholder={t('search_runs')} emptyLabel={t('no_runs')} exportName="payroll-runs" />
      )}

      <EmployeeDialog open={empDialog} onClose={() => setEmpDialog(false)} onSaved={load} employee={editing} />
      <CreateRunDialog open={runDialog} onClose={() => setRunDialog(false)} onCreated={() => { load(); setTab('runs'); }} />
      <RunDetailDialog runId={activeRun} onClose={() => setActiveRun(null)} onChanged={load} />
    </div>
  );
}
