'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Ban, Copy, Pencil, Plus, Search, ShieldCheck, Trash2, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

type RolePreview = {
  id: string;
  name: string;
  type: 'مستخدم' | 'موظف' | 'مدير';
  description: string;
  permissionCount: number;
};

const roles: RolePreview[] = [
  { id: 'role-admin', name: 'الإدارة', type: 'مدير', description: 'متابعة العمليات وإدارة إعدادات العمل', permissionCount: 48 },
  { id: 'role-employee', name: 'موظف', type: 'مستخدم', description: 'الوصول اليومي للمهام المصرّح بها', permissionCount: 18 },
  { id: 'role-driver', name: 'سائق', type: 'مستخدم', description: 'متابعة أوامر النقل والحجوزات الخاصة به', permissionCount: 9 },
  { id: 'role-sales', name: 'مندوب مبيعات', type: 'مستخدم', description: 'متابعة العملاء والفواتير والعروض', permissionCount: 22 },
  { id: 'role-cashier', name: 'كاشير', type: 'مستخدم', description: 'تشغيل نقطة البيع وجلساته الخاصة', permissionCount: 12 },
  { id: 'role-worker', name: 'بائع', type: 'موظف', description: 'مهام تشغيلية داخل الفرع', permissionCount: 6 },
];

/** معاينة محلية لقائمة الأدوار؛ لا تمس أدوار المستخدمين أو صلاحياتهم الفعلية. */
export default function EmployeeRolesPreviewPage() {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [message, setMessage] = useState('');

  const filteredRoles = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ar');
    return roles.filter((role) => {
      const matchesText = !normalized || [role.name, role.type, role.description].some((value) => value.toLocaleLowerCase('ar').includes(normalized));
      return matchesText && (type === 'all' || role.type === type);
    });
  }, [query, type]);

  function simulateAction(action: string, role: RolePreview) {
    setMessage(`تمت محاكاة إجراء «${action}» على دور «${role.name}» داخل الواجهة فقط. لا تتغير أي صلاحيات أو حسابات فعلية.`);
  }

  return (
    <main className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted" aria-label="مسار التنقل">
        <Link href="/employee-management" className="transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">الموظفين</Link>
        <span aria-hidden="true">/</span>
        <span className="text-text">إدارة أدوار الموظفين</span>
      </div>

      <div className="flex flex-wrap items-start gap-4 border-b border-border pb-4">
        <Link href="/employee-management" className="inline-flex h-9 w-9 items-center justify-center rounded text-muted transition-colors hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label="العودة إلى إدارة الموظفين"><ArrowRight className="h-4 w-4" strokeWidth={1.7} /></Link>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold text-text">أدوار الموظفين</h1><span className="rounded border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">معاينة واجهة</span></div>
          <p className="mt-1 text-sm text-muted">اعرض الأدوار ونطاقها للتقييم البصري؛ كل المعلومات في هذه الصفحة نموذجية ومحلية.</p>
        </div>
        <div className="ms-auto"><Link href="/employee-roles/new" className="inline-flex h-9 items-center justify-center gap-2 rounded bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><Plus className="h-4 w-4" strokeWidth={1.8} />إضافة دور جديد</Link></div>
      </div>

      <section className="rounded border border-primary/20 bg-primary-soft px-3 py-2.5" aria-label="نطاق المعاينة">
        <div className="flex items-start gap-2 text-sm text-text"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} aria-hidden="true" /><p><strong>معاينة معزولة.</strong> النسخ والتعديل والحذف والصفحات المحظورة إجراءات مرئية فقط؛ لا تمنح أو تسحب أي صلاحية فعلية.</p></div>
      </section>

      {message && <div className="rounded border border-positive/30 bg-positive/10 px-3 py-2.5 text-sm text-text" role="status" aria-live="polite">{message}</div>}

      <section className="rounded border border-border bg-surface" aria-labelledby="roles-table-title">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3"><div><h2 id="roles-table-title" className="font-semibold text-text">الأدوار الوظيفية</h2><p className="mt-0.5 text-xs text-muted">{filteredRoles.length} من {roles.length} أدوار نموذجية</p></div><span className="rounded border border-border bg-background px-2 py-1 text-xs text-muted">إدارة داخلية</span></div>
        <div className="grid grid-cols-1 gap-3 border-b border-border p-4 md:grid-cols-[minmax(0,1fr)_180px]">
          <div className="relative"><Label htmlFor="role-search" className="sr-only">البحث في الأدوار</Label><Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-muted" strokeWidth={1.7} /><Input id="role-search" className="ps-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث باسم الدور أو نوعه…" /></div>
          <div><Label htmlFor="role-type" className="sr-only">نوع الدور</Label><Select id="role-type" value={type} onChange={(event) => setType(event.target.value)}><option value="all">كل الأنواع</option><option value="مستخدم">مستخدم</option><option value="موظف">موظف</option><option value="مدير">مدير</option></Select></div>
        </div>

        <div className="hidden overflow-x-auto lg:block"><table className="w-full text-right text-sm"><thead className="border-b border-border bg-background text-xs font-medium text-muted"><tr><th className="px-4 py-3">الدور الوظيفي</th><th className="px-4 py-3">النوع</th><th className="px-4 py-3">الصلاحيات النموذجية</th><th className="px-4 py-3 text-end">الإجراءات</th></tr></thead><tbody className="divide-y divide-border">{filteredRoles.map((role) => <RoleRow key={role.id} role={role} onAction={simulateAction} />)}</tbody></table></div>
        <div className="divide-y divide-border lg:hidden">{filteredRoles.map((role) => <RoleCard key={role.id} role={role} onAction={simulateAction} />)}</div>

        {filteredRoles.length === 0 && <div className="px-4 py-12 text-center"><UsersRound className="mx-auto h-5 w-5 text-muted" strokeWidth={1.7} /><p className="mt-2 text-sm font-medium text-text">لا توجد أدوار مطابقة</p><p className="mt-1 text-xs text-muted">جرّب تغيير البحث أو نوع الدور.</p></div>}
      </section>
    </main>
  );
}

function RoleRow({ role, onAction }: { role: RolePreview; onAction: (action: string, role: RolePreview) => void }) {
  return <tr className="transition-colors hover:bg-background/70"><td className="px-4 py-4"><p className="font-medium text-text">{role.name}</p><p className="mt-0.5 text-xs text-muted">{role.description}</p></td><td className="px-4 py-4"><TypeBadge type={role.type} /></td><td className="px-4 py-4"><span className="num text-text">{role.permissionCount}</span><span className="ms-1 text-xs text-muted">صلاحية نموذجية</span></td><td className="px-4 py-4"><RoleActions role={role} onAction={onAction} /></td></tr>;
}

function RoleCard({ role, onAction }: { role: RolePreview; onAction: (action: string, role: RolePreview) => void }) {
  return <article className="space-y-3 px-4 py-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium text-text">{role.name}</p><p className="mt-1 text-xs text-muted">{role.description}</p></div><TypeBadge type={role.type} /></div><div className="border-t border-border pt-3"><p className="text-xs text-muted">الصلاحيات النموذجية</p><p className="num mt-1 text-sm font-medium text-text">{role.permissionCount}</p></div><RoleActions role={role} onAction={onAction} /></article>;
}

function RoleActions({ role, onAction }: { role: RolePreview; onAction: (action: string, role: RolePreview) => void }) {
  return <div className="flex flex-wrap items-center justify-end gap-1.5"><ActionButton label="تعديل" icon={Pencil} onClick={() => onAction('تعديل', role)} /><ActionButton label="نسخ" icon={Copy} onClick={() => onAction('نسخ', role)} /><ActionButton label="الصفحات المحظورة" icon={Ban} onClick={() => onAction('الصفحات المحظورة', role)} /><ActionButton label="حذف" icon={Trash2} destructive onClick={() => onAction('حذف', role)} /></div>;
}

function ActionButton({ label, icon: Icon, destructive, onClick }: { label: string; icon: typeof Pencil; destructive?: boolean; onClick: () => void }) {
  return <Button type="button" variant="outline" size="sm" className={cn('h-8', destructive && 'hover:border-negative/40 hover:bg-negative/10 hover:text-negative')} onClick={onClick}><Icon className="h-3.5 w-3.5" strokeWidth={1.7} />{label}</Button>;
}

function TypeBadge({ type }: { type: RolePreview['type'] }) {
  const tone = type === 'مدير' ? 'border-warning/30 bg-warning/10 text-warning' : type === 'مستخدم' ? 'border-primary/20 bg-primary-soft text-primary' : 'border-border bg-background text-muted';
  return <span className={cn('rounded border px-2 py-1 text-xs font-medium', tone)}>{type}</span>;
}
