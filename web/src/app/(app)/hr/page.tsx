'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Pencil, Trash2, MapPin, User, UserCog } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dropdown, DropdownItem } from '@/components/ui/dropdown';
import { EmployeeDialog, type Employee } from '@/components/hr/employee-dialog';
import { ShiftDialog, type Shift } from '@/components/hr/shift-dialog';
import { AttendanceDialog, type Attendance, type AttendanceStatus } from '@/components/hr/attendance-dialog';
import { CreateRunDialog } from '@/components/hr/create-run-dialog';
import { RunDetailDialog, type PayrollRun } from '@/components/hr/run-detail-dialog';
import { RoleDialog, type Role } from '@/components/hr/role-dialog';
import { UserDialog } from '@/components/users/user-dialog';
import { UserScopeDialog } from '@/components/users/user-scope-dialog';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { formatRiyal } from '@/lib/money';
import { cn } from '@/lib/utils';

type Tab = 'employees' | 'shifts' | 'attendance' | 'runs' | 'roles' | 'users';

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
  const tu = useTranslations('users');
  const ts = useTranslations('status');
  const tc = useTranslations('common');
  const { success, error } = useToast();
  const [tab, setTab] = useState<Tab>('employees');

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);

  const [empDialog, setEmpDialog] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [shiftDialog, setShiftDialog] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [attDialog, setAttDialog] = useState(false);
  const [editingAtt, setEditingAtt] = useState<Attendance | null>(null);
  const [runDialog, setRunDialog] = useState(false);
  const [activeRun, setActiveRun] = useState<string | null>(null);

  // الأدوار والمستخدمون: تبويبان حسّاسان يظهران لأصحاب الإدارة فقط (owner/admin).
  // يُقرآن بعد التركيب لتفادي اختلاف الترطيب (localStorage غائب أثناء العرض على الخادم).
  const [role, setRole] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  useEffect(() => {
    const me = currentUser();
    setRole(me?.role ?? null);
    setMeId(me?.id ?? null);
  }, []);
  const canManageRoles = role === 'owner' || role === 'admin';

  const [roles, setRoles] = useState<Role[]>([]);
  const [permCatalog, setPermCatalog] = useState<string[]>([]);
  const [roleDialog, setRoleDialog] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);

  const reloadRoles = useCallback(() => {
    api<{ data: Role[]; meta: { permissions: string[] } }>('/roles')
      .then((r) => { setRoles(r.data); setPermCatalog(r.meta?.permissions ?? []); })
      .catch(() => {});
  }, []);

  useEffect(() => { if (canManageRoles) reloadRoles(); }, [canManageRoles, reloadRoles]);

  const [team, setTeam] = useState<TeamUser[]>([]);
  const [userDialog, setUserDialog] = useState(false);
  const [scopeUser, setScopeUser] = useState<TeamUser | null>(null);

  const loadTeam = useCallback(() => {
    if (!canManageRoles) return;
    api<{ data: TeamUser[] }>('/users').then((r) => setTeam(r.data)).catch(() => {});
  }, [canManageRoles]);

  useEffect(() => { if (canManageRoles) loadTeam(); }, [canManageRoles, loadTeam]);

  async function removeUser(id: string) {
    await api(`/users/${id}`, { method: 'DELETE' }).catch(() => {});
    success(tc('deleted'));
    loadTeam();
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
      { accessorKey: 'name', header: t('emp_name') },
      { accessorKey: 'job_title', header: t('job_title'), cell: ({ row }) => row.original.job_title ?? '—' },
      { accessorKey: 'basic_salary', header: t('basic_salary'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.basic_salary)}</div> },
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

  const deleteRole = useCallback((r: Role) => {
    if (!window.confirm(t('confirm_delete_role'))) return;
    api(`/roles/${r.id}`, { method: 'DELETE' })
      .then(() => { success(tc('deleted')); reloadRoles(); })
      .catch((e) => error(e instanceof ApiError ? e.message : tc('saveFailed')));
  }, [t, tc, success, error, reloadRoles]);

  const roleColumns = useMemo<ColumnDef<Role, unknown>[]>(
    () => [
      { accessorKey: 'name', header: t('role_name'), cell: ({ row }) => <span className="font-medium text-text">{row.original.name}</span> },
      {
        id: 'perms',
        header: t('role_perms_count'),
        cell: ({ row }) =>
          row.original.permissions.includes('*')
            ? <Badge tone="neutral">{t('full_access')}</Badge>
            : <span className="num text-muted">{row.original.permissions.length}</span>,
      },
      { accessorKey: 'users_count', header: t('role_users_count'), cell: ({ row }) => <span className="num text-muted">{row.original.users_count}</span> },
      {
        id: 'kind',
        header: '',
        cell: ({ row }) => <Badge tone="muted">{row.original.is_system ? t('role_system') : t('role_custom')}</Badge>,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" aria-label={row.original.is_owner ? t('view_role') : t('edit')} onClick={() => { setEditingRole(row.original); setRoleDialog(true); }}>
              <Pencil className="h-4 w-4" strokeWidth={1.7} />
            </Button>
            {/* النظامي والمالك لا يُحذفان — نُخفي الزر بدل أن يصطدم بـ422. */}
            {!row.original.is_system && (
              <Button variant="ghost" size="icon" aria-label={t('delete')} onClick={() => deleteRole(row.original)}>
                <Trash2 className="h-4 w-4" strokeWidth={1.7} />
              </Button>
            )}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, deleteRole]
  );

  const userColumns = useMemo<ColumnDef<TeamUser, unknown>[]>(
    () => [
      { accessorKey: 'name', header: tu('name') },
      { accessorKey: 'email', header: tu('email'), cell: ({ row }) => <span className="num text-muted">{row.original.email}</span> },
      { accessorKey: 'role', header: tu('role'), cell: ({ row }) => <Badge tone="muted">{tu(`roles.${row.original.role}`)}</Badge> },
      {
        id: 'employee',
        header: tu('link_employee'),
        accessorFn: (r) => r.employee?.name ?? '',
        cell: ({ row }) => (
          <span className="text-muted">
            {row.original.employee ? `${row.original.employee.employee_no ? `${row.original.employee.employee_no} — ` : ''}${row.original.employee.name}` : '—'}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" aria-label={tu('scope_title')} onClick={() => setScopeUser(row.original)}>
              <MapPin className="h-4 w-4 text-muted" strokeWidth={1.7} />
            </Button>
            {row.original.id !== meId && (
              <Button variant="ghost" size="icon" aria-label={tu('remove')} onClick={() => removeUser(row.original.id)}>
                <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
              </Button>
            )}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tu, meId]
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
        <DropdownItem icon={User} onClick={() => { setEditing(null); setEmpDialog(true); }}>{t('add_employee_option')}</DropdownItem>
        <DropdownItem icon={UserCog} onClick={() => setUserDialog(true)}>{t('add_user_option')}</DropdownItem>
      </Dropdown>
    ),
    shifts: () => (<Button onClick={() => { setEditingShift(null); setShiftDialog(true); }}><Plus className="h-4 w-4" strokeWidth={1.8} />{t('add_shift')}</Button>),
    attendance: () => (<Button onClick={() => { setEditingAtt(null); setAttDialog(true); }}><Plus className="h-4 w-4" strokeWidth={1.8} />{t('add_attendance')}</Button>),
    runs: () => (<Button onClick={() => setRunDialog(true)}><Plus className="h-4 w-4" strokeWidth={1.8} />{t('create_run')}</Button>),
    roles: () => (<Button onClick={() => { setEditingRole(null); setRoleDialog(true); }}><Plus className="h-4 w-4" strokeWidth={1.8} />{t('add_role')}</Button>),
    users: () => (<Button onClick={() => setUserDialog(true)}><Plus className="h-4 w-4" strokeWidth={1.8} />{tu('add')}</Button>),
  }[tab];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        {addButton()}
      </div>

      <div className="flex gap-1 border-b border-border">
        {(['employees', 'shifts', 'attendance', 'runs', ...(canManageRoles ? ['roles', 'users'] : [])] as Tab[]).map((key) => (
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
      {tab === 'roles' && canManageRoles && (
        <DataTable columns={roleColumns} data={roles} loading={loading} searchPlaceholder={t('search_roles')} emptyLabel={t('no_roles')} exportName="roles" />
      )}
      {tab === 'users' && canManageRoles && (
        <DataTable columns={userColumns} data={team} loading={loading} searchPlaceholder={t('search_users')} emptyLabel={t('no_users')} exportName="users" />
      )}

      <EmployeeDialog open={empDialog} onClose={() => setEmpDialog(false)} onSaved={load} employee={editing} />
      <ShiftDialog open={shiftDialog} onClose={() => setShiftDialog(false)} onSaved={load} shift={editingShift} />
      <AttendanceDialog open={attDialog} onClose={() => setAttDialog(false)} onSaved={load} attendance={editingAtt} />
      <CreateRunDialog open={runDialog} onClose={() => setRunDialog(false)} onCreated={() => { load(); setTab('runs'); }} />
      <RunDetailDialog runId={activeRun} onClose={() => setActiveRun(null)} onChanged={load} />
      <RoleDialog open={roleDialog} onClose={() => setRoleDialog(false)} onSaved={reloadRoles} role={editingRole} catalog={permCatalog} />
      <UserDialog
        open={userDialog}
        onClose={() => setUserDialog(false)}
        onSaved={loadTeam}
        linkedEmployeeIds={team.map((u) => u.employee_id).filter((id): id is string => !!id)}
      />
      {scopeUser && (
        <UserScopeDialog user={scopeUser} onClose={() => setScopeUser(null)} onSaved={loadTeam} />
      )}
    </div>
  );
}
