'use client';

import { FormEvent, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckSquare, Info, Save, ShieldCheck, UserRoundCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

type PermissionGroup = { id: string; title: string; description: string; permissions: string[] };

const permissionGroups: PermissionGroup[] = [
  { id: 'pos', title: 'نقاط البيع', description: 'جلسات البيع وخيارات نقطة البيع.', permissions: ['فتح جلسة خاصة', 'إغلاق جلسة خاصة', 'عرض جلساتي', 'إضافة خصم'] },
  { id: 'sales', title: 'المبيعات', description: 'الفواتير وعروض الأسعار والتحصيل.', permissions: ['عرض الفواتير', 'إضافة فاتورة مسودة', 'تعديل الفواتير الخاصة به', 'عرض عروض الأسعار'] },
  { id: 'employees', title: 'الموظفون', description: 'عرض ملفات الموظفين وأدوارهم في المعاينة.', permissions: ['عرض الموظفين', 'إضافة موظف جديد', 'إدارة الأدوار الوظيفية', 'عرض وثائق الموظفين'] },
  { id: 'attendance', title: 'حضور الموظفين', description: 'الحضور والإجازات والورديات.', permissions: ['عرض سجلات الحضور', 'إدارة الورديات', 'عرض وردياتي', 'إضافة طلب إجازة'] },
  { id: 'reports', title: 'التقارير', description: 'العرض المرئي للتقارير فقط.', permissions: ['عرض التقارير التشغيلية', 'تصدير المعاينة'] },
];

/** معاينة نموذج الدور؛ التبديلات لا تحفظ ولا تطبق على مستخدمين أو خدمات فعلية. */
export default function NewEmployeeRolePreviewPage() {
  const [roleName, setRoleName] = useState('');
  const [roleType, setRoleType] = useState('user');
  const [selected, setSelected] = useState<string[]>(['عرض الفواتير', 'عرض الموظفين', 'عرض وردياتي']);
  const [notice, setNotice] = useState('');

  const selectedCount = useMemo(() => selected.length, [selected]);

  function togglePermission(permission: string) {
    setSelected((current) => current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission]);
  }

  function toggleGroup(group: PermissionGroup) {
    const allSelected = group.permissions.every((permission) => selected.includes(permission));
    setSelected((current) => allSelected ? current.filter((item) => !group.permissions.includes(item)) : [...new Set([...current, ...group.permissions])]);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(`تمت محاكاة حفظ دور «${roleName || 'جديد'}» مع ${selectedCount} صلاحيات نموذجية. لا يتم إنشاء دور أو تعديل وصول فعلي.`);
  }

  return (
    <main className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted" aria-label="مسار التنقل"><Link href="/employee-roles" className="transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">أدوار الموظفين</Link><span aria-hidden="true">/</span><span className="text-text">إضافة دور جديد</span></div>

      <div className="flex flex-wrap items-start gap-4 border-b border-border pb-4">
        <Link href="/employee-roles" className="inline-flex h-9 w-9 items-center justify-center rounded text-muted transition-colors hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label="العودة إلى أدوار الموظفين"><ArrowRight className="h-4 w-4" strokeWidth={1.7} /></Link>
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold text-text">إضافة دور وظيفي</h1><span className="rounded border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">معاينة واجهة</span></div><p className="mt-1 text-sm text-muted">صمّم دوراً جديداً وجرب توزيع الصلاحيات محلياً قبل أي اعتماد وظيفي.</p></div>
        <div className="ms-auto flex gap-2"><Link href="/employee-roles" className="inline-flex h-9 items-center justify-center rounded px-3 text-sm font-medium text-muted transition-colors hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">إلغاء</Link><Button type="submit" form="role-preview-form"><Save className="h-4 w-4" strokeWidth={1.7} />حفظ للمعاينة</Button></div>
      </div>

      <section className="rounded border border-primary/20 bg-primary-soft px-3 py-2.5"><div className="flex items-start gap-2 text-sm text-text"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} /><p><strong>المعاينة لا تمنح صلاحيات.</strong> كل اختيار أدناه يبقى في ذاكرة المتصفح فقط ولا يؤثر في الأدوار أو الحسابات أو نطاقات الوصول.</p></div></section>
      {notice && <div className="rounded border border-positive/30 bg-positive/10 px-3 py-2.5 text-sm text-text" role="status" aria-live="polite">{notice}</div>}

      <form id="role-preview-form" onSubmit={submit} className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-5">
          <Card><CardHeader className="border-b border-border pb-4"><CardTitle className="flex items-center gap-2 text-base"><UserRoundCog className="h-4 w-4 text-primary" strokeWidth={1.8} />تعريف الدور</CardTitle><p className="pt-1 text-xs font-normal text-muted">الاسم والنوع يحددان شكل المعاينة فقط.</p></CardHeader><CardContent className="pt-5"><div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Field label="اسم الدور الوظيفي" htmlFor="role-name" required><Input id="role-name" value={roleName} onChange={(event) => setRoleName(event.target.value)} placeholder="مثال: مشرف فرع" required /></Field><Field label="نوع الدور" htmlFor="role-type" required><Select id="role-type" value={roleType} onChange={(event) => setRoleType(event.target.value)}><option value="user">مستخدم</option><option value="employee">موظف</option><option value="manager">مدير (أدمن)</option></Select></Field></div></CardContent></Card>

          <Card><CardHeader className="border-b border-border pb-4"><CardTitle className="flex items-center gap-2 text-base"><CheckSquare className="h-4 w-4 text-primary" strokeWidth={1.8} />التطبيقات ومجموعات الصلاحيات</CardTitle><p className="pt-1 text-xs font-normal text-muted">فئات مختصرة من المرجع، تعرض التحديد والتراجع بصرياً فقط.</p></CardHeader><CardContent className="space-y-3 pt-5">{permissionGroups.map((group) => <PermissionGroupCard key={group.id} group={group} selected={selected} onTogglePermission={togglePermission} onToggleGroup={toggleGroup} />)}</CardContent></Card>
        </div>

        <aside className="xl:sticky xl:top-4 xl:self-start"><Card><CardHeader className="border-b border-border pb-4"><CardTitle className="text-base">ملخص المعاينة</CardTitle></CardHeader><CardContent className="space-y-4 pt-5 text-sm"><SummaryLine label="الدور" value={roleName || 'دور جديد'} /><SummaryLine label="النوع" value={roleType === 'manager' ? 'مدير (أدمن)' : roleType === 'employee' ? 'موظف' : 'مستخدم'} /><SummaryLine label="الصلاحيات المختارة" value={`${selectedCount} صلاحيات نموذجية`} /><div className="border-t border-border pt-4"><p className="text-xs font-medium text-text">حدود هذه الصفحة</p><p className="mt-1.5 text-xs leading-5 text-muted">الحفظ يحدّث رسالة محلية فقط. لا تنشئ الصفحة دوراً ولا تربطه بمستخدم أو فرع أو صفحة محظورة.</p></div><Button type="submit" form="role-preview-form" className="w-full"><Save className="h-4 w-4" strokeWidth={1.7} />حفظ للمعاينة</Button></CardContent></Card></aside>
      </form>
    </main>
  );
}

function PermissionGroupCard({ group, selected, onTogglePermission, onToggleGroup }: { group: PermissionGroup; selected: string[]; onTogglePermission: (permission: string) => void; onToggleGroup: (group: PermissionGroup) => void }) {
  const active = group.permissions.filter((permission) => selected.includes(permission)).length;
  const allSelected = active === group.permissions.length;
  return <section className="rounded border border-border"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-3 py-3"><div><h3 className="font-medium text-text">{group.title}</h3><p className="mt-0.5 text-xs text-muted">{active}/{group.permissions.length} صلاحيات محددة للمعاينة</p></div><Button type="button" variant="outline" size="sm" onClick={() => onToggleGroup(group)}>{allSelected ? 'إلغاء تحديد الكل' : 'تحديد الكل'}</Button></div><div className="grid grid-cols-1 divide-y divide-border md:grid-cols-2 md:divide-x md:divide-x-reverse md:divide-y-0">{group.permissions.map((permission) => <label key={permission} className="flex cursor-pointer items-center gap-2.5 px-3 py-3 text-sm text-text"><input type="checkbox" checked={selected.includes(permission)} onChange={() => onTogglePermission(permission)} className="h-4 w-4 rounded border-border text-primary focus:ring-primary" />{permission}</label>)}</div></section>;
}

function Field({ label, htmlFor, required, children }: { label: string; htmlFor: string; required?: boolean; children: React.ReactNode }) { return <div className="space-y-1.5"><Label htmlFor={htmlFor}>{label}{required && <span className="text-negative"> *</span>}</Label>{children}</div>; }
function SummaryLine({ label, value }: { label: string; value: string }) { return <div className="flex items-start justify-between gap-3"><span className="text-muted">{label}</span><span className={cn('text-end text-text', value === 'دور جديد' && 'text-muted')}>{value}</span></div>; }
