'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight, Download, FileText, Pencil, Trash2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabPanel, type TabDef } from '@/components/ui/tabs';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { KeyValue, SubHead, EmptyPanel } from '@/components/partners/partner-panels';
import { useToast } from '@/components/ui/toast';
import { EmployeeDialog, type Employee, type LinkedUser } from '@/components/hr/employee-dialog';
import { ContractDialog, type Contract } from '@/components/hr/contract-dialog';
import { type Attendance, type AttendanceStatus } from '@/components/hr/attendance-dialog';
import { type PayrollRun } from '@/components/hr/run-detail-dialog';
import { SYSTEM_ROLE_KEYS } from '@/components/users/user-dialog';
import { api, ApiError, downloadFile } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { formatRiyal } from '@/lib/money';

interface EmployeeProfile extends Employee {
  branch_id?: string | null;
  hire_date?: string | null;
  notes?: string | null;
  // مصدرها العقد النشط اليوم (Contract)، لا حقول الموظف — للعرض فقط، انظر تبويب العقود.
  active_contract_id?: string | null;
  basic_salary?: string;
  allowances?: string;
  gosi?: string;
  other_deductions?: string;
  gross?: string;
  net?: string;
  manager?: { id: string; name: string } | null;
}

interface EmployeeAttachment {
  id: string;
  original_name: string;
  mime_type?: string | null;
  size: number;
}

const SECTIONS = ['details', 'contracts', 'attachments', 'attendance', 'payroll'] as const;
type SectionId = (typeof SECTIONS)[number];

const attStatusTone: Record<AttendanceStatus, 'positive' | 'warning' | 'muted' | 'negative'> = {
  present: 'positive', late: 'warning', leave: 'muted', absent: 'negative',
};
const runStatusTone: Record<string, 'positive' | 'warning' | 'muted'> = { paid: 'positive', posted: 'warning', draft: 'muted' };
const contractStatusTone: Record<Contract['status'], 'positive' | 'warning' | 'muted'> = {
  active: 'positive', ended: 'muted', terminated: 'warning',
};

const ADDRESS_FIELDS = ['address', 'building_no', 'street', 'district', 'city', 'postal_code', 'country'] as const;

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function EmployeeProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('hr');
  const tu = useTranslations('users');
  const ts = useTranslations('status');
  const tc = useTranslations('common');

  const { success, error: toastError } = useToast();
  const [employee, setEmployee] = useState<EmployeeProfile | null>(null);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([]);
  const [attachments, setAttachments] = useState<EmployeeAttachment[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [linkedUser, setLinkedUser] = useState<LinkedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<SectionId>('details');
  const [editOpen, setEditOpen] = useState(false);
  const [contractDialogOpen, setContractDialogOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [busyContractId, setBusyContractId] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [busyAttachmentId, setBusyAttachmentId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [role, setRole] = useState<string | null>(null);
  useEffect(() => { setRole(currentUser()?.role ?? null); }, []);
  const canManageUsers = role === 'owner' || role === 'admin';

  const loadAttachments = useCallback(() => {
    if (!id) return;
    api<{ data: EmployeeAttachment[] }>(`/employees/${id}/attachments`).then((r) => setAttachments(r.data)).catch(() => setAttachments([]));
  }, [id]);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      api<{ data: EmployeeProfile }>(`/employees/${id}`).then((r) => setEmployee(r.data)).catch(() => setEmployee(null)),
      api<{ data: Attendance[] }>(`/attendances?employee_id=${id}`).then((r) => setAttendance(r.data)).catch(() => setAttendance([])),
      api<{ data: PayrollRun[] }>(`/payroll-runs?employee_id=${id}`).then((r) => setPayrollRuns(r.data)).catch(() => setPayrollRuns([])),
      api<{ data: EmployeeAttachment[] }>(`/employees/${id}/attachments`).then((r) => setAttachments(r.data)).catch(() => setAttachments([])),
      api<{ data: Contract[] }>(`/employees/${id}/contracts`).then((r) => setContracts(r.data)).catch(() => setContracts([])),
    ]).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => load(), [load]);

  async function deleteContract(contract: Contract) {
    if (!id || !window.confirm(t('confirm_delete_contract'))) return;
    setBusyContractId(contract.id);
    try {
      await api(`/employees/${id}/contracts/${contract.id}`, { method: 'DELETE' });
      success(tc('deleted'));
      load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setBusyContractId(null);
    }
  }

  async function uploadAttachments(files: FileList | null) {
    if (!files || files.length === 0 || !id) return;
    setUploading(true);
    try {
      const body = new FormData();
      Array.from(files).forEach((file) => body.append('attachments[]', file));
      await api(`/employees/${id}/attachments`, { method: 'POST', body });
      success(tc('created'));
      loadAttachments();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : t('upload_attachment_failed'));
    } finally {
      setUploading(false);
    }
  }

  async function downloadAttachment(attachment: EmployeeAttachment) {
    if (!id) return;
    setBusyAttachmentId(attachment.id);
    try {
      await downloadFile(`/employees/${id}/attachments/${attachment.id}`, attachment.original_name);
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : t('download_attachment_failed'));
    } finally {
      setBusyAttachmentId(null);
    }
  }

  async function deleteAttachment(attachment: EmployeeAttachment) {
    if (!id || !window.confirm(t('confirm_delete_attachment'))) return;
    setBusyAttachmentId(attachment.id);
    try {
      await api(`/employees/${id}/attachments/${attachment.id}`, { method: 'DELETE' });
      success(tc('deleted'));
      setAttachments((prev) => prev.filter((a) => a.id !== attachment.id));
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : t('delete_attachment_failed'));
    } finally {
      setBusyAttachmentId(null);
    }
  }

  useEffect(() => {
    if (!canManageUsers || !id) { setLinkedUser(null); return; }
    api<{ data: (LinkedUser & { employee_id?: string | null })[] }>('/users')
      .then((r) => setLinkedUser(r.data.find((u) => u.employee_id === id) ?? null))
      .catch(() => {});
  }, [canManageUsers, id]);

  const fmtHours = (m: number) => `${Math.floor(m / 60)} ${t('hours_short')} ${m % 60} ${t('minutes_short')}`;

  const addressLine = (prefix: 'current' | 'permanent') => {
    if (!employee) return '';
    return ADDRESS_FIELDS
      .map((field) => employee[`${prefix}_${field}` as keyof EmployeeProfile] as string | null | undefined)
      .filter(Boolean)
      .join('، ');
  };

  const tabs: TabDef[] = [
    { id: 'details', label: t('tab_details') },
    { id: 'contracts', label: t('contracts'), count: contracts.length },
    { id: 'attachments', label: t('attachments'), count: attachments.length },
    { id: 'attendance', label: t('attendance'), count: attendance.length },
    { id: 'payroll', label: t('runs'), count: payrollRuns.length },
  ];

  function panel(s: SectionId) {
    if (!employee) return null;
    switch (s) {
      case 'details':
        return (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x lg:divide-x-reverse lg:divide-border">
              <div>
                <SubHead>{t('job_data')}</SubHead>
                <KeyValue label={t('employee_no')} value={employee.employee_no || '—'} mono />
                <KeyValue label={t('job_title')} value={employee.job_title?.name ?? '—'} />
                <KeyValue label={t('department')} value={employee.department?.name ?? '—'} />
                <KeyValue label={t('job_level')} value={employee.job_level?.name ?? '—'} />
                <KeyValue label={t('employment_type')} value={employee.employment_type?.name ?? '—'} />
                <KeyValue
                  label={t('manager')}
                  value={employee.manager?.name ?? '—'}
                  href={employee.manager ? `/hr/employees/${employee.manager.id}` : undefined}
                />
                <KeyValue label={t('hire_date')} value={employee.hire_date || '—'} mono />
                <KeyValue label={t('status_label')} value={employee.is_active ? t('active') : t('inactive')} />
              </div>
              <div>
                <SubHead>{t('personal_data')}</SubHead>
                <KeyValue label={t('national_id')} value={employee.national_id || '—'} mono />
                <KeyValue label={t('nationality')} value={employee.nationality || '—'} />
                <KeyValue label={t('residency_expiry_date')} value={employee.residency_expiry_date || '—'} mono />
                <KeyValue label={t('phone')} value={employee.phone || '—'} mono />
                <KeyValue label={t('personal_email')} value={employee.personal_email || '—'} />
              </div>
            </div>

            <SubHead>{t('current_address_title')}</SubHead>
            <p className="px-4 py-3 text-sm text-text">{addressLine('current') || <span className="text-muted">{t('no_address')}</span>}</p>
            <SubHead>{t('permanent_address_title')}</SubHead>
            <p className="px-4 py-3 text-sm text-text">{addressLine('permanent') || <span className="text-muted">{t('no_address')}</span>}</p>

            <SubHead>{t('compensation')}</SubHead>
            <KeyValue label={t('basic_salary')} value={formatRiyal(employee.basic_salary)} mono />
            <KeyValue label={t('allowances')} value={formatRiyal(employee.allowances)} mono />
            <KeyValue label={t('gosi')} value={formatRiyal(employee.gosi)} mono />
            <KeyValue label={t('other_deductions')} value={formatRiyal(employee.other_deductions)} mono />
            <KeyValue label={t('gross')} value={formatRiyal(employee.gross ?? '0')} mono />
            <KeyValue label={t('net')} value={formatRiyal(employee.net ?? '0')} mono />

            <SubHead>{t('notes')}</SubHead>
            <p className="px-4 py-3 text-sm text-text">{employee.notes || <span className="text-muted">—</span>}</p>

            {canManageUsers && (
              <>
                <SubHead>{t('login_access')}</SubHead>
                {linkedUser ? (
                  <>
                    <KeyValue label={tu('email')} value={linkedUser.email} mono />
                    <KeyValue label={tu('role')} value={tu(`roles.${linkedUser.role}`)} />
                    <KeyValue label={tu('status_label')} value={linkedUser.is_active ? tu('active') : tu('inactive')} />
                  </>
                ) : (
                  <EmptyPanel>{t('no_login_access')}</EmptyPanel>
                )}
              </>
            )}
          </>
        );
      case 'contracts':
        return (
          <div className="space-y-3 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted">{t('contracts_hint')}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => { setEditingContract(null); setContractDialogOpen(true); }}>
                {t('add_contract')}
              </Button>
            </div>

            {contracts.length === 0 ? (
              <EmptyPanel>{t('no_contracts')}</EmptyPanel>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>{t('contract_type')}</TH>
                    <TH>{t('start_date')}</TH>
                    <TH>{t('end_date')}</TH>
                    <TH className="text-end">{t('gross')}</TH>
                    <TH className="text-end">{t('net')}</TH>
                    <TH>{t('status_label')}</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  {contracts.map((c) => (
                    <TR key={c.id}>
                      <TD>{t(`type_${c.type}`)}</TD>
                      <TD className="num text-muted" dir="ltr">{c.start_date}</TD>
                      <TD className="num text-muted" dir="ltr">{c.end_date ?? '—'}</TD>
                      <TD className="num text-end">{formatRiyal(c.gross)}</TD>
                      <TD className="num text-end font-medium">{formatRiyal(c.net)}</TD>
                      <TD><Badge tone={contractStatusTone[c.status] ?? 'muted'}>{t(`status_${c.status}`)}</Badge></TD>
                      <TD className="text-end">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" aria-label={t('edit')} onClick={() => { setEditingContract(c); setContractDialogOpen(true); }}>
                            <Pencil className="h-3.5 w-3.5" strokeWidth={1.7} />
                          </Button>
                          <Button variant="ghost" size="icon" aria-label={t('delete_contract')} disabled={busyContractId === c.id} onClick={() => deleteContract(c)}>
                            <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
                          </Button>
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </div>
        );
      case 'attachments':
        return (
          <div className="space-y-3 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted">{t('attachment_hint')}</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.gif,.zip"
                className="hidden"
                onChange={(e) => { uploadAttachments(e.target.files); e.target.value = ''; }}
              />
              <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" strokeWidth={1.8} />
                {uploading ? t('uploading') : t('attachment_upload')}
              </Button>
            </div>

            {attachments.length === 0 ? (
              <EmptyPanel>{t('no_attachments')}</EmptyPanel>
            ) : (
              <div className="divide-y divide-border rounded border border-border">
                {attachments.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 px-3 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.7} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-text">{a.original_name}</p>
                        <p className="text-xs text-muted">{a.mime_type || t('unknown_file_type')} · {formatBytes(a.size)}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="outline" size="sm" disabled={busyAttachmentId === a.id} onClick={() => downloadAttachment(a)}>
                        <Download className="h-3.5 w-3.5" strokeWidth={1.7} />
                        {t('download')}
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={t('remove_attachment')} disabled={busyAttachmentId === a.id} onClick={() => deleteAttachment(a)}>
                        <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      case 'attendance':
        return attendance.length === 0 ? (
          <EmptyPanel>{t('no_attendance')}</EmptyPanel>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t('attendance_date')}</TH>
                <TH>{t('shifts')}</TH>
                <TH>{t('check_in')}</TH>
                <TH>{t('worked_hours')}</TH>
                <TH>{t('status_label')}</TH>
              </TR>
            </THead>
            <TBody>
              {attendance.map((a) => (
                <TR key={a.id}>
                  <TD className="num text-muted" dir="ltr">{a.attendance_date}</TD>
                  <TD className="text-muted">{a.shift?.name ?? '—'}</TD>
                  <TD className="num text-muted" dir="ltr">{a.check_in ? `${a.check_in} — ${a.check_out ?? '—'}` : '—'}</TD>
                  <TD className="num">{a.worked_minutes ? fmtHours(a.worked_minutes) : '—'}</TD>
                  <TD><Badge tone={attStatusTone[a.status] ?? 'muted'}>{t(`att_${a.status}`)}</Badge></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        );
      case 'payroll':
        return payrollRuns.length === 0 ? (
          <EmptyPanel>{t('no_runs')}</EmptyPanel>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t('run_number')}</TH>
                <TH>{t('period')}</TH>
                <TH className="text-end">{t('gross')}</TH>
                <TH className="text-end">{t('gosi')}</TH>
                <TH className="text-end">{t('other_deductions')}</TH>
                <TH className="text-end">{t('total_net')}</TH>
                <TH>{t('status_label')}</TH>
              </TR>
            </THead>
            <TBody>
              {payrollRuns.map((run) => {
                const item = run.items?.[0];
                return (
                  <TR key={run.id}>
                    <TD className="num text-muted" dir="ltr">{run.number}</TD>
                    <TD className="num text-muted">{run.period}</TD>
                    <TD className="num text-end">{formatRiyal(item?.gross ?? '0')}</TD>
                    <TD className="num text-end">{formatRiyal(item?.gosi ?? '0')}</TD>
                    <TD className="num text-end">{formatRiyal(item?.other_deductions ?? '0')}</TD>
                    <TD className="num text-end font-medium">{formatRiyal(item?.net ?? '0')}</TD>
                    <TD><Badge tone={runStatusTone[run.status] ?? 'muted'}>{ts(run.status)}</Badge></TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        );
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="rounded border border-border bg-surface p-10 text-center text-sm text-muted">
        {t('not_found')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button variant="ghost" size="icon" onClick={() => router.push('/hr')} aria-label={tc('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <div className="min-w-0">
          <div className="text-xs text-muted">
            {t('employees')} {employee.employee_no && <span className="num">#{employee.employee_no}</span>}
          </div>
          <h1 className="truncate text-lg font-semibold text-text">{employee.name}</h1>
        </div>
        <Badge tone={employee.is_active ? 'positive' : 'muted'}>{employee.is_active ? t('active') : t('inactive')}</Badge>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('edit')}
        </Button>
      </div>

      <div className="overflow-hidden rounded border border-border bg-surface">
        <Tabs tabs={tabs} value={section} onChange={(s) => setSection(s as SectionId)} />
        <TabPanel id={section}>{panel(section)}</TabPanel>
      </div>

      <EmployeeDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={load}
        employee={employee}
        linkedUser={linkedUser}
        initialAllowAccess={!!linkedUser}
        canManageUsers={canManageUsers}
      />

      <ContractDialog
        open={contractDialogOpen}
        onClose={() => setContractDialogOpen(false)}
        onSaved={load}
        employeeId={employee.id}
        contract={editingContract}
      />
    </div>
  );
}
