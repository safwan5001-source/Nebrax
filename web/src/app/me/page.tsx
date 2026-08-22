'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { LogIn, LogOut as ClockOut, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabPanel, type TabDef } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

interface Employee {
  id: string;
  name: string;
  employee_no?: string | null;
  job_title?: { name: string } | null;
  department?: { name: string } | null;
  hire_date?: string | null;
  phone?: string | null;
  personal_email?: string | null;
}

interface ContractItem { id: string; category: string; name: string; amount: string }
interface Contract {
  id: string; type: string; status: string; start_date: string | null;
  items: ContractItem[]; basic_salary: string; gosi: string; other_deductions: string;
  gross: string; net: string;
}

interface Attendance {
  id: string; attendance_date: string; check_in: string | null; check_out: string | null;
  status: string; worked_minutes: number;
}

interface PayrollRunMeta { id: string; period: string; period_start: string | null; period_end: string | null; status: string; paid_at: string | null }
interface PayrollItem {
  id: string; basic_salary: string; allowances: string; gosi: string;
  other_deductions: string; gross: string; net: string; run: PayrollRunMeta | null;
}

const attStatusTone: Record<string, 'positive' | 'warning' | 'muted' | 'negative'> = {
  present: 'positive', late: 'warning', leave: 'muted', absent: 'negative',
};

export default function SelfServicePortal() {
  const t = useTranslations('selfService');
  const { success, error } = useToast();

  const [tab, setTab] = useState<'overview' | 'attendance' | 'payroll'>('overview');
  const [loading, setLoading] = useState(true);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [contract, setContract] = useState<Contract | null>(null);
  const [attendances, setAttendances] = useState<Attendance[]>([]);
  const [payrollItems, setPayrollItems] = useState<PayrollItem[]>([]);
  const [busy, setBusy] = useState(false);

  const tabs: TabDef[] = [
    { id: 'overview', label: t('tabs.overview') },
    { id: 'attendance', label: t('tabs.attendance') },
    { id: 'payroll', label: t('tabs.payroll') },
  ];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [profileRes, contractRes, attRes, payRes] = await Promise.all([
        api<{ data: Employee }>('/me/profile'),
        api<{ data: Contract | null }>('/me/contract'),
        api<{ data: Attendance[] }>('/me/attendances'),
        api<{ data: PayrollItem[] }>('/me/payroll-items'),
      ]);
      setEmployee(profileRes.data);
      setContract(contractRes.data);
      setAttendances(attRes.data);
      setPayrollItems(payRes.data);
    } catch (e) {
      error(e instanceof ApiError ? e.message : t('load_error'));
    } finally {
      setLoading(false);
    }
  }, [error, t]);

  useEffect(() => {
    load();
  }, [load]);

  const today = attendances.find((a) => a.attendance_date === new Date().toISOString().slice(0, 10));

  async function checkIn() {
    setBusy(true);
    try {
      await api('/me/attendance/check-in', { method: 'POST' });
      success(t('checked_in'));
      await load();
    } catch (e) {
      error(e instanceof ApiError ? e.message : t('load_error'));
    } finally {
      setBusy(false);
    }
  }

  async function checkOut() {
    setBusy(true);
    try {
      await api('/me/attendance/check-out', { method: 'POST' });
      success(t('checked_out'));
      await load();
    } catch (e) {
      error(e instanceof ApiError ? e.message : t('load_error'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-text">{t('title', { name: employee?.name ?? '' })}</h1>
        <p className="mt-0.5 text-sm text-muted">{employee?.job_title?.name ?? '—'}{employee?.department ? ` · ${employee.department.name}` : ''}</p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 !pt-4">
          <Clock className="h-5 w-5 text-muted" strokeWidth={1.7} aria-hidden="true" />
          <div className="flex-1">
            <p className="text-sm font-medium text-text">
              {today?.check_in
                ? t('today_checked_in_at', { time: today.check_in })
                : t('today_not_checked_in')}
            </p>
            {today?.check_out && (
              <p className="text-xs text-muted">{t('today_checked_out_at', { time: today.check_out })}</p>
            )}
          </div>
          {!today?.check_in && (
            <Button onClick={checkIn} disabled={busy}>
              <LogIn className="h-4 w-4" strokeWidth={1.7} /> {t('check_in')}
            </Button>
          )}
          {today?.check_in && !today?.check_out && (
            <Button variant="outline" onClick={checkOut} disabled={busy}>
              <ClockOut className="h-4 w-4" strokeWidth={1.7} /> {t('check_out')}
            </Button>
          )}
        </CardContent>
      </Card>

      <Tabs tabs={tabs} value={tab} onChange={(id) => setTab(id as typeof tab)} />

      {tab === 'overview' && (
        <TabPanel id="overview">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>{t('profile_title')}</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label={t('employee_no')} value={employee?.employee_no ?? '—'} />
                <Row label={t('hire_date')} value={employee?.hire_date ?? '—'} />
                <Row label={t('phone')} value={employee?.phone ?? '—'} />
                <Row label={t('personal_email')} value={employee?.personal_email ?? '—'} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>{t('contract_title')}</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {!contract && <p className="text-muted">{t('no_active_contract')}</p>}
                {contract && (
                  <>
                    <Row label={t('basic_salary')} value={formatRiyal(contract.basic_salary)} />
                    <Row label={t('gosi')} value={formatRiyal(contract.gosi)} />
                    <Row label={t('other_deductions')} value={formatRiyal(contract.other_deductions)} />
                    <div className="mt-2 border-t border-border pt-2">
                      <Row label={t('net_salary')} value={formatRiyal(contract.net)} strong />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </TabPanel>
      )}

      {tab === 'attendance' && (
        <TabPanel id="attendance">
          <Card>
            <CardContent className="!pt-4">
              {attendances.length === 0 && <p className="text-sm text-muted">{t('no_attendance')}</p>}
              <div className="divide-y divide-border">
                {attendances.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="num text-text">{a.attendance_date}</span>
                    <span className="num text-muted">
                      {a.check_in ?? '—'} → {a.check_out ?? '—'}
                    </span>
                    <Badge tone={attStatusTone[a.status] ?? 'muted'}>{t(`status.${a.status}`)}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabPanel>
      )}

      {tab === 'payroll' && (
        <TabPanel id="payroll">
          <Card>
            <CardContent className="!pt-4">
              {payrollItems.length === 0 && <p className="text-sm text-muted">{t('no_payroll')}</p>}
              <div className="divide-y divide-border">
                {payrollItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="text-text">{item.run?.period ?? '—'}</span>
                    <span className="num font-medium text-text">{formatRiyal(item.net)}</span>
                    {item.run && <Badge tone={item.run.status === 'paid' ? 'positive' : 'warning'}>{t(`status.${item.run.status}`)}</Badge>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabPanel>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className={strong ? 'num font-semibold text-text' : 'num text-text'}>{value}</span>
    </div>
  );
}
