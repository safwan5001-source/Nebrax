'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Pencil, User, UserCog } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dropdown, DropdownItem } from '@/components/ui/dropdown';
import { EmployeeDialog, type Employee, type LinkedUser } from '@/components/hr/employee-dialog';
import { ShiftDialog, type Shift } from '@/components/hr/shift-dialog';
import { AttendanceDialog, type Attendance, type AttendanceStatus } from '@/components/hr/attendance-dialog';
import { CreateRunDialog } from '@/components/hr/create-run-dialog';
import { RunDetailDialog, type PayrollRun } from '@/components/hr/run-detail-dialog';
import { OrgStructureManager } from '@/components/hr/org-structure-manager';
import { LeaveManager } from '@/components/hr/leave-manager';
import { RequestsManager } from '@/components/hr/requests-manager';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { useCan } from '@/lib/use-can';
import { formatRiyal } from '@/lib/money';
import { cn } from '@/lib/utils';
import { useConfirm } from '@/components/ui/confirm-dialog';

type Tab = 'employees' | 'shifts' | 'attendance' | 'runs' | 'leave' | 'requests' | 'org_structure';
const TABS: Tab[] = ['employees', 'shifts', 'attendance', 'runs', 'leave', 'requests', 'org_structure'];

interface TeamUser {
  id: string; name: string; email: string; role: string; is_active: boolean;
  branch_ids?: string[]; warehouse_ids?: string[];
  employee_id?: string | null;
  employee?: { id: string; name: string; employee_no?: string } | null;
}
const statusTone: Record<string, 'positive' | 'warning' | 'muted'> = { paid: 'positive', posted: 'warning', draft: 'muted' };
const attStatusTone: Record<AttendanceStatus, 'positive' | 'warning' | 'muted' | 'negative'> = {
  present: 'positive', late: 'warning', leave: 'muted', absent: 'negative',
};

export default function HrPage() {
  const t = useTranslations('hr');
  const askConfirm = useConfirm();
  const ts = useTranslations('status');
  const tc = useTranslations('common');
  const { success, error } = useToast();
  // رابط الشريط الجانبي لبعض التبويبات (الحضور، الرواتب، الطلبات) يفتح
  // مباشرة على تبويبها عبر `?tab=` — بدل صفحة منفصلة كانت 404 من قبل.
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestedTab = searchParams.get('tab');
  // المستخدمون والأدوار صارا شاشتين مستقلتين بصلاحيتَي `users.view` / `roles.view` (AC-UX-01/03A):
  // الروابط والإشارات القديمة إلى `?tab=users|roles` تُحوَّل إليهما بدل أن تسقط على «الموظفون».
  useEffect(() => {
    if (requestedTab === 'users') router.replace('/users');
    if (requestedTab === 'roles') router.replace('/roles');
  }, [requestedTab, router]);
  const [tab, setTab] = useState<Tab>(
    TABS.includes(requestedTab as Tab) ? (requestedTab as Tab) : 'employees'
  );

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);

  const [empDialog, setEmpDialog] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [empLinkedUser, setEmpLinkedUser] = useState<LinkedUser | null>(null);
  const [empInitialAccess, setEmpInitialAccess] = useState(false);
  const [shiftDialog, setShiftDialog] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [attDialog, setAttDialog] = useState(false);
  const [editingAtt, setEditingAtt] = useState<Attendance | null>(null);
  const [runDialog, setRunDialog] = useState(false);
  const [activeRun, setActiveRun] = useState<string | null>(null);

  // الأدوار والمستخدمون: تبويبان حسّاسان يظهران لأصحاب الإدارة فقط (owner/admin).
  // يُقرآن بعد التركيب لتفادي اختلاف الترطيب (localStorage غائب أثناء العرض على الخادم).
  const { viewer: me, can } = useCan();
  const role = me?.role ?? null;
  const meId = me?.id ?? null;
  const canReadUsers = can('users.view');
  // إدارة الدخول تتبع صلاحيات الخادم لا اسم الدور: القراءة (`users.view`) لعرض حالة الدخول، والكتابة (`users.manage`) لإنشائه.
  const canManageUsers = canReadUsers && can('users.manage');
  // تبويب الهيكل التنظيمي بقي لـowner/admin عمداً (المحاسب يملك `hr.manage` افتراضياً ولم يكن يراه) — قرار منتج لا تقني.
  const canManageOrg = role === 'owner' || role === 'admin';


  const [team, setTeam] = useState<TeamUser[]>([]);
  const [teamLoaded, setTeamLoaded] = useState(false);

  const loadTeam = useCallback(() => {
    if (!canManageUsers) return;
    api<{ data: TeamUser[] }>('/users').then((r) => setTeam(r.data)).catch(() => {}).finally(() => setTeamLoaded(true));
  }, [canManageUsers]);

  useEffect(() => { if (canManageUsers) loadTeam(); }, [canManageUsers, loadTeam]);

  // نطاق المشاهد المخزَّن من صفّه في قائمة المستخدمين (لا نقطة نهاية للنطاق الفعلي): فراغ = غير مقيَّد.
  // `undefined` = ما زالت القائمة تُحمَّل؛ `null` = انتهت ولم يوجد صفّه/فشلت (يحسم الخادم).
  const actorScope = useMemo(() => {
    if (!teamLoaded) return undefined;
    const meId = currentUser()?.id;
    const own = meId ? team.find((u) => u.id === meId) : undefined;
    return own ? { branches: own.branch_ids ?? [], warehouses: own.warehouse_ids ?? [] } : null;
  }, [team, teamLoaded]);

  const toLinkedUser = (u: TeamUser): LinkedUser => ({
    id: u.id, name: u.name, email: u.email, role: u.role, is_active: u.is_active,
    branch_ids: u.branch_ids, warehouse_ids: u.warehouse_ids,
  });

  // فتح نموذج الموظف الموحّد لتعديل موظفٍ من تبويب "الموظفون" — يُرفَق مستخدمه
  // المرتبط تلقائياً إن وُجد، فيظهر قسم الدخول معبّأً بدل فارغ.
  function openEmployeeEdit(emp: Employee) {
    setEditing(emp);
    const linked = team.find((u) => u.employee_id === emp.id) ?? null;
    setEmpLinkedUser(linked ? toLinkedUser(linked) : null);
    setEmpInitialAccess(!!linked);
    setEmpDialog(true);
  }

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api<{ data: Employee[] }>('/employees'),
      api<{ data: Shift[] }>('/shifts'),
      api<{ data: Attendance[] }>('/attendances'),
      api<{ data: PayrollRun[] }>('/payroll-runs'),
    ])
      .then(([e, sh, at, r]) => {
        setEmployees(e.data);
        setShifts(sh.data);
        setAttendance(at.data);
        setRuns(r.data);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  const empColumns = useMemo<ColumnDef<Employee, unknown>[]>(
    () => [
      { accessorKey: 'employee_no', header: t('employee_no'), cell: ({ row }) => <span className="num text-muted">{row.original.employee_no}</span> },
      {
        accessorKey: 'name',
        header: t('emp_name'),
        cell: ({ row }) => (
          <Link href={`/hr/employees/${row.original.id}`} className="font-medium text-primary hover:underline">
            {row.original.name}
          </Link>
        ),
      },
      { accessorKey: 'job_title', header: t('job_title'), cell: ({ row }) => row.original.job_title?.name ?? '—' },
      {
        id: 'basic_salary',
        header: t('basic_salary'),
        accessorFn: (r) => (r as Employee & { basic_salary?: string }).basic_salary ?? '0',
        cell: ({ row }) => <div className="num text-end">{formatRiyal((row.original as Employee & { basic_salary?: string }).basic_salary)}</div>,
      },
      {
        id: 'gross',
        header: t('gross'),
        accessorFn: (r) => (r as Employee & { gross?: string }).gross ?? '0',
        cell: ({ row }) => <div className="num text-end">{formatRiyal((row.original as Employee & { gross?: string }).gross)}</div>,
      },
      {
        id: 'net',
        header: t('net'),
        accessorFn: (r) => (r as Employee & { net?: string }).net ?? '0',
        cell: ({ row }) => <div className="num text-end font-medium">{formatRiyal((row.original as Employee & { net?: string }).net)}</div>,
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
          <Button variant="ghost" size="icon" aria-label={t('edit')} onClick={() => openEmployeeEdit(row.original)}>
            <Pencil className="h-4 w-4" strokeWidth={1.7} />
          </Button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, team]
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

  const weekdays = t.raw('weekdays') as string[];
  const fmtHours = (m: number) => `${Math.floor(m / 60)} ${t('hours_short')} ${m % 60} ${t('minutes_short')}`;

  const shiftColumns = useMemo<ColumnDef<Shift, unknown>[]>(
    () => [
      { accessorKey: 'name', header: t('shift_name') },
      {
        id: 'time',
        header: t('start_time'),
        cell: ({ row }) => <span className="num text-muted" dir="ltr">{row.original.start_time} — {row.original.end_time}</span>,
      },
      { id: 'net', header: t('net_hours'), cell: ({ row }) => <span className="num">{fmtHours(row.original.net_minutes)}</span> },
      {
        id: 'days',
        header: t('work_days'),
        cell: ({ row }) => <span className="text-muted">{row.original.work_days.map((d) => weekdays[d]).join('، ')}</span>,
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
          <Button variant="ghost" size="icon" aria-label={t('edit')} onClick={() => { setEditingShift(row.original); setShiftDialog(true); }}>
            <Pencil className="h-4 w-4" strokeWidth={1.7} />
          </Button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t]
  );

  const attColumns = useMemo<ColumnDef<Attendance, unknown>[]>(
    () => [
      { accessorKey: 'attendance_date', header: t('attendance_date'), cell: ({ row }) => <span className="num text-muted" dir="ltr">{row.original.attendance_date}</span> },
      { id: 'employee', header: t('employee'), accessorFn: (r) => r.employee?.name ?? '', cell: ({ row }) => row.original.employee?.name ?? '—' },
      { id: 'shift', header: t('shifts'), cell: ({ row }) => <span className="text-muted">{row.original.shift?.name ?? '—'}</span> },
      {
        id: 'time',
        header: t('check_in'),
        cell: ({ row }) =>
          row.original.check_in ? <span className="num text-muted" dir="ltr">{row.original.check_in} — {row.original.check_out ?? '—'}</span> : <span className="text-muted">—</span>,
      },
      { id: 'worked', header: t('worked_hours'), cell: ({ row }) => <span className="num">{row.original.worked_minutes ? fmtHours(row.original.worked_minutes) : '—'}</span> },
      {
        accessorKey: 'status',
        header: t('status_label'),
        cell: ({ row }) => <Badge tone={attStatusTone[row.original.status] ?? 'muted'}>{t(`att_${row.original.status}`)}</Badge>,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Button variant="ghost" size="icon" aria-label={t('edit')} onClick={() => { setEditingAtt(row.original); setAttDialog(true); }}>
            <Pencil className="h-4 w-4" strokeWidth={1.7} />
          </Button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t]
  );


  const addButton = {
    // زرٌ عام "إضافة" يفتح خيارَي دفترة نفسيهما (موظف / مستخدم) بدل زرٍّ واحد
    // يفترض موظفاً دائماً — إنشاء حساب دخول لا يحتاج المرور بنموذج الموظف أولاً.
    employees: () => (
      <Dropdown
        align="end"
        menuLabel={t('add')}
        triggerClassName="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        trigger={<><Plus className="h-4 w-4" strokeWidth={1.8} />{t('add')}</>}
      >
        <DropdownItem icon={User} onClick={() => { setEditing(null); setEmpLinkedUser(null); setEmpInitialAccess(false); setEmpDialog(true); }}>{t('add_employee_option')}</DropdownItem>
        <DropdownItem icon={UserCog} onClick={() => { setEditing(null); setEmpLinkedUser(null); setEmpInitialAccess(true); setEmpDialog(true); }}>{t('add_user_option')}</DropdownItem>
      </Dropdown>
    ),
    shifts: () => (<Button onClick={() => { setEditingShift(null); setShiftDialog(true); }}><Plus className="h-4 w-4" strokeWidth={1.8} />{t('add_shift')}</Button>),
    attendance: () => (<Button onClick={() => { setEditingAtt(null); setAttDialog(true); }}><Plus className="h-4 w-4" strokeWidth={1.8} />{t('add_attendance')}</Button>),
    runs: () => (<Button onClick={() => setRunDialog(true)}><Plus className="h-4 w-4" strokeWidth={1.8} />{t('create_run')}</Button>),
    // أزرّة الإضافة الخاصّة بهذه الأقسام داخلية في مكوّناتها (كلٌّ يتبدّل حسب القسم الفرعي/النوع النشط).
    org_structure: () => null,
    leave: () => null,
    requests: () => null,
  }[tab];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        {addButton()}
      </div>

      <div className="flex gap-1 border-b border-border">
        {(['employees', 'shifts', 'attendance', 'runs', 'leave', 'requests', ...(canManageOrg ? ['org_structure'] : [])] as Tab[]).map((key) => (
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

      {tab === 'employees' && (
        <DataTable columns={empColumns} data={employees} loading={loading} searchPlaceholder={t('search_employees')} emptyLabel={t('no_employees')} exportName="employees" />
      )}
      {tab === 'shifts' && (
        <DataTable columns={shiftColumns} data={shifts} loading={loading} searchPlaceholder={t('search_shifts')} emptyLabel={t('no_shifts')} exportName="shifts" />
      )}
      {tab === 'attendance' && (
        <DataTable columns={attColumns} data={attendance} loading={loading} searchPlaceholder={t('search_attendance')} emptyLabel={t('no_attendance')} exportName="attendance" />
      )}
      {tab === 'runs' && (
        <DataTable columns={runColumns} data={runs} loading={loading} searchPlaceholder={t('search_runs')} emptyLabel={t('no_runs')} exportName="payroll-runs" />
      )}
      {tab === 'leave' && <LeaveManager />}
      {tab === 'requests' && <RequestsManager />}
      {tab === 'org_structure' && canManageOrg && <OrgStructureManager />}

      <EmployeeDialog
        open={empDialog}
        onClose={() => setEmpDialog(false)}
        onSaved={() => { load(); if (canManageUsers) loadTeam(); }}
        employee={editing}
        linkedUser={empLinkedUser}
        initialAllowAccess={empInitialAccess}
        canManageUsers={canManageUsers}
        actorScope={actorScope}
        canReadActorScope={canReadUsers}
      />
      <ShiftDialog open={shiftDialog} onClose={() => setShiftDialog(false)} onSaved={load} shift={editingShift} />
      <AttendanceDialog open={attDialog} onClose={() => setAttDialog(false)} onSaved={load} attendance={editingAtt} />
      <CreateRunDialog open={runDialog} onClose={() => setRunDialog(false)} onCreated={() => { load(); setTab('runs'); }} />
      <RunDetailDialog runId={activeRun} onClose={() => setActiveRun(null)} onChanged={load} />
    </div>
  );
}
