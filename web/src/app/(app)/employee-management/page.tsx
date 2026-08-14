'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Filter,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

type EmployeePreview = {
  id: string;
  initials: string;
  name: string;
  code: string;
  role: string;
  department: string;
  status: 'نشط' | 'معلّق';
  accountType: 'مستخدم' | 'موظف';
  tone: 'primary' | 'positive' | 'warning' | 'muted';
};

const employees: EmployeePreview[] = [
  { id: 'emp-1042', initials: 'رن', name: 'ريم الناصر', code: '#1042', role: 'أخصائية مبيعات', department: 'قسم المبيعات', status: 'نشط', accountType: 'مستخدم', tone: 'primary' },
  { id: 'emp-1037', initials: 'خح', name: 'خالد الحربي', code: '#1037', role: 'مشرف المستودع', department: 'العمليات والمخزون', status: 'نشط', accountType: 'موظف', tone: 'positive' },
  { id: 'emp-1031', initials: 'نه', name: 'نورة حسن', code: '#1031', role: 'محاسبة', department: 'الحسابات', status: 'نشط', accountType: 'مستخدم', tone: 'warning' },
  { id: 'emp-1026', initials: 'مس', name: 'مازن السالم', code: '#1026', role: 'أخصائي موارد بشرية', department: 'الموارد البشرية', status: 'معلّق', accountType: 'موظف', tone: 'muted' },
  { id: 'emp-1018', initials: 'لب', name: 'ليان بدر', code: '#1018', role: 'خدمة عملاء', department: 'إدارة العملاء', status: 'نشط', accountType: 'مستخدم', tone: 'primary' },
  { id: 'emp-1012', initials: 'عي', name: 'عمر ياسين', code: '#1012', role: 'منسق عمليات', department: 'التشغيل والعمليات', status: 'نشط', accountType: 'موظف', tone: 'positive' },
];

const toneClasses: Record<EmployeePreview['tone'], string> = {
  primary: 'bg-primary text-primary-foreground',
  positive: 'bg-positive text-white',
  warning: 'bg-warning text-white',
  muted: 'bg-muted text-text',
};

/**
 * معاينة واجهة إدارة الموظفين.
 * جميع السجلات محلية وثابتة، ولا توجد أي طلبات شبكة أو قراءة/حفظ لبيانات المؤسسة.
 */
export default function EmployeeManagementPreviewPage() {
  const [query, setQuery] = useState('');
  const [accountType, setAccountType] = useState('all');
  const [status, setStatus] = useState('all');

  const filteredEmployees = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ar');
    return employees.filter((employee) => {
      const matchesQuery = !normalized || [employee.name, employee.code, employee.role, employee.department]
        .some((value) => value.toLocaleLowerCase('ar').includes(normalized));
      const matchesType = accountType === 'all' || employee.accountType === accountType;
      const matchesStatus = status === 'all' || employee.status === status;
      return matchesQuery && matchesType && matchesStatus;
    });
  }, [accountType, query, status]);

  return (
    <main className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted" aria-label="مسار التنقل">
        <Link href="/dashboard" className="transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">لوحة التحكم</Link>
        <span aria-hidden="true">/</span>
        <span>الموظفين</span>
        <span aria-hidden="true">/</span>
        <span className="text-text">إدارة الموظفين</span>
      </div>

      <div className="flex flex-wrap items-start gap-4 border-b border-border pb-4">
        <Link href="/dashboard" className="inline-flex h-9 w-9 items-center justify-center rounded text-muted transition-colors hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label="العودة إلى لوحة التحكم">
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Link>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-text">إدارة الموظفين</h1>
            <span className="rounded border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">معاينة واجهة</span>
          </div>
          <p className="mt-1 text-sm text-muted">دليل موحّد لمستخدمي المنشأة وموظفيها، ببيانات نموذجية محلية فقط.</p>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Link href="/employee-management/new" className="inline-flex h-9 items-center justify-center gap-2 rounded bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <Plus className="h-4 w-4" strokeWidth={1.8} />
            إضافة مستخدم أو موظف
          </Link>
        </div>
      </div>

      <section className="rounded border border-primary/20 bg-primary-soft px-3 py-2.5" aria-label="نطاق المعاينة">
        <div className="flex items-start gap-2 text-sm text-text">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} aria-hidden="true" />
          <p><strong>معاينة معزولة.</strong> لا تُقرأ هذه الصفحة من بيانات المستخدمين أو الموظفين، ولا ينفذ زر الإضافة أو أي إجراء تغييرات فعلية.</p>
        </div>
      </section>

      <section className="rounded border border-border bg-surface" aria-labelledby="employee-directory-title">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 id="employee-directory-title" className="font-semibold text-text">دليل الموظفين</h2>
            <p className="mt-0.5 text-xs text-muted">{filteredEmployees.length} من {employees.length} سجلات نموذجية</p>
          </div>
          <span className="rounded border border-border bg-background px-2 py-1 text-xs text-muted">عرض داخلي</span>
        </div>

        <div className="grid grid-cols-1 gap-3 border-b border-border p-4 md:grid-cols-[minmax(0,1fr)_150px_150px]">
          <div className="relative">
            <Label htmlFor="employee-search" className="sr-only">ابحث في الموظفين</Label>
            <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-muted" strokeWidth={1.7} aria-hidden="true" />
            <Input id="employee-search" value={query} onChange={(event) => setQuery(event.target.value)} className="ps-9" placeholder="ابحث بالاسم أو الرمز أو الوظيفة…" />
          </div>
          <div>
            <Label htmlFor="employee-type" className="sr-only">نوع الحساب</Label>
            <Select id="employee-type" value={accountType} onChange={(event) => setAccountType(event.target.value)}>
              <option value="all">كل الأنواع</option>
              <option value="مستخدم">مستخدم</option>
              <option value="موظف">موظف</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="employee-status" className="sr-only">الحالة</Label>
            <Select id="employee-status" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">كل الحالات</option>
              <option value="نشط">نشط</option>
              <option value="معلّق">معلّق</option>
            </Select>
          </div>
        </div>

        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full text-right text-sm">
            <thead className="border-b border-border bg-background text-xs font-medium text-muted">
              <tr>
                <th scope="col" className="px-4 py-3">الموظف</th>
                <th scope="col" className="px-4 py-3">الوظيفة والقسم</th>
                <th scope="col" className="px-4 py-3">نوع السجل</th>
                <th scope="col" className="px-4 py-3">الحالة</th>
                <th scope="col" className="px-4 py-3 text-end"><span className="sr-only">إجراءات</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredEmployees.map((employee) => <EmployeeRow key={employee.id} employee={employee} />)}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-border lg:hidden">
          {filteredEmployees.map((employee) => <EmployeeCard key={employee.id} employee={employee} />)}
        </div>

        {filteredEmployees.length === 0 && (
          <div className="px-4 py-12 text-center">
            <Users className="mx-auto h-5 w-5 text-muted" strokeWidth={1.6} aria-hidden="true" />
            <p className="mt-2 text-sm font-medium text-text">لا توجد نتائج مطابقة</p>
            <p className="mt-1 text-xs text-muted">جرّب تغيير كلمات البحث أو معايير التصفية.</p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted">
          <p>هذه القائمة محلية لغرض المعاينة ولا تمثل بيانات المنشأة.</p>
          <div className="flex items-center gap-1" aria-label="ترقيم الصفحات — معاينة">
            <Button type="button" variant="ghost" size="icon" disabled aria-label="الصفحة السابقة"><ChevronRight className="h-4 w-4" strokeWidth={1.7} /></Button>
            <span className="rounded bg-primary-soft px-2 py-1 font-medium text-primary">1</span>
            <Button type="button" variant="ghost" size="icon" disabled aria-label="الصفحة التالية"><ChevronLeft className="h-4 w-4" strokeWidth={1.7} /></Button>
          </div>
        </div>
      </section>
    </main>
  );
}

function EmployeeRow({ employee }: { employee: EmployeePreview }) {
  return (
    <tr className="transition-colors hover:bg-background/70">
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <EmployeeMark employee={employee} />
          <div>
            <p className="font-medium text-text">{employee.name}</p>
            <p className="num mt-0.5 text-xs text-muted">{employee.code}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3.5"><p className="text-text">{employee.role}</p><p className="mt-0.5 text-xs text-muted">{employee.department}</p></td>
      <td className="px-4 py-3.5"><span className="rounded border border-border bg-background px-2 py-1 text-xs text-muted">{employee.accountType}</span></td>
      <td className="px-4 py-3.5"><StatusBadge status={employee.status} /></td>
      <td className="px-4 py-3.5 text-end"><Button type="button" variant="ghost" size="icon" aria-label={`إجراءات ${employee.name}`}><Ellipsis className="h-4 w-4" strokeWidth={1.7} /></Button></td>
    </tr>
  );
}

function EmployeeCard({ employee }: { employee: EmployeePreview }) {
  return (
    <article className="space-y-3 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3"><EmployeeMark employee={employee} /><div className="min-w-0"><p className="truncate font-medium text-text">{employee.name}</p><p className="num mt-0.5 text-xs text-muted">{employee.code}</p></div></div>
        <Button type="button" variant="ghost" size="icon" aria-label={`إجراءات ${employee.name}`}><Ellipsis className="h-4 w-4" strokeWidth={1.7} /></Button>
      </div>
      <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs">
        <div><p className="text-muted">الوظيفة</p><p className="mt-1 text-sm text-text">{employee.role}</p></div>
        <div><p className="text-muted">القسم</p><p className="mt-1 text-sm text-text">{employee.department}</p></div>
        <div><p className="text-muted">النوع</p><p className="mt-1 text-sm text-text">{employee.accountType}</p></div>
        <div><p className="text-muted">الحالة</p><div className="mt-1"><StatusBadge status={employee.status} /></div></div>
      </div>
    </article>
  );
}

function EmployeeMark({ employee }: { employee: EmployeePreview }) {
  return <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded text-sm font-semibold', toneClasses[employee.tone])}>{employee.initials}</span>;
}

function StatusBadge({ status }: { status: EmployeePreview['status'] }) {
  const active = status === 'نشط';
  return <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', active ? 'text-positive' : 'text-muted')}><span className={cn('h-2 w-2 rounded-full', active ? 'bg-positive' : 'bg-muted')} aria-hidden="true" />{status}</span>;
}
