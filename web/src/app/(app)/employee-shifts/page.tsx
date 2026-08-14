'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Clock3, Pencil, Plus, Search, ShieldCheck, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type ShiftPreview = { id: string; name: string; period: string; employees: number; daysOff: string; start: string; end: string };

const shifts: ShiftPreview[] = [
  { id: 'shift-1', name: 'الوردية الصباحية #1', period: 'صباحية', employees: 3, daysOff: 'الجمعة، السبت', start: '08:00', end: '16:00' },
  { id: 'shift-2', name: 'الوردية المسائية #2', period: 'مسائية', employees: 2, daysOff: 'الجمعة', start: '14:00', end: '22:00' },
  { id: 'shift-3', name: 'وردية المستودع', period: 'تشغيلية', employees: 4, daysOff: 'السبت', start: '07:00', end: '15:00' },
];

/** معاينة مستقلة للورديات؛ لا تُنشئ وردية أو تعدل الحضور أو جدولة الموظفين. */
export default function EmployeeShiftsPreviewPage() {
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const filteredShifts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ar');
    return shifts.filter((shift) => !normalized || [shift.name, shift.period, shift.daysOff].some((value) => value.toLocaleLowerCase('ar').includes(normalized)));
  }, [query]);

  return (
    <main className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted" aria-label="مسار التنقل"><Link href="/employee-management" className="transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">الموظفين</Link><span aria-hidden="true">/</span><span className="text-text">إدارة الورديات</span></div>
      <div className="flex flex-wrap items-start gap-4 border-b border-border pb-4"><Link href="/employee-management" className="inline-flex h-9 w-9 items-center justify-center rounded text-muted transition-colors hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label="العودة إلى إدارة الموظفين"><ArrowRight className="h-4 w-4" strokeWidth={1.7} /></Link><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold text-text">الورديات</h1><span className="rounded border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">معاينة واجهة</span></div><p className="mt-1 text-sm text-muted">نظرة منظمة إلى الورديات وأوقات العمل وأيام العطلات ببيانات نموذجية محلية.</p></div><div className="ms-auto"><Link href="/employee-shifts/new" className="inline-flex h-9 items-center justify-center gap-2 rounded bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><Plus className="h-4 w-4" strokeWidth={1.8} />إضافة وردية</Link></div></div>
      <section className="rounded border border-primary/20 bg-primary-soft px-3 py-2.5"><div className="flex items-start gap-2 text-sm text-text"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} /><p><strong>معاينة معزولة.</strong> تعديل وردية أو إضافتها هنا لا يؤثر في الحضور أو جداول العمل أو الموظفين الفعليين.</p></div></section>
      {message && <div className="rounded border border-positive/30 bg-positive/10 px-3 py-2.5 text-sm text-text" role="status" aria-live="polite">{message}</div>}

      <section className="rounded border border-border bg-surface" aria-labelledby="shifts-table-title"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3"><div><h2 id="shifts-table-title" className="font-semibold text-text">قائمة الورديات</h2><p className="mt-0.5 text-xs text-muted">{filteredShifts.length} من {shifts.length} ورديات نموذجية</p></div><span className="rounded border border-border bg-background px-2 py-1 text-xs text-muted">إدارة داخلية</span></div><div className="border-b border-border p-4"><div className="relative max-w-lg"><Label htmlFor="shift-search" className="sr-only">البحث في الورديات</Label><Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-muted" strokeWidth={1.7} /><Input id="shift-search" className="ps-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث باسم الوردية أو أيام العطلات…" /></div></div>
        <div className="hidden overflow-x-auto lg:block"><table className="w-full text-right text-sm"><thead className="border-b border-border bg-background text-xs font-medium text-muted"><tr><th className="px-4 py-3">الاسم</th><th className="px-4 py-3">الوقت</th><th className="px-4 py-3">عدد الموظفين</th><th className="px-4 py-3">أيام العطلات</th><th className="px-4 py-3 text-end"><span className="sr-only">إجراء</span></th></tr></thead><tbody className="divide-y divide-border">{filteredShifts.map((shift) => <ShiftRow key={shift.id} shift={shift} onEdit={() => setMessage(`تمت محاكاة تعديل «${shift.name}» داخل الواجهة فقط. لا تتغير جداول أو حضور الموظفين.`)} />)}</tbody></table></div>
        <div className="divide-y divide-border lg:hidden">{filteredShifts.map((shift) => <ShiftCard key={shift.id} shift={shift} onEdit={() => setMessage(`تمت محاكاة تعديل «${shift.name}» داخل الواجهة فقط. لا تتغير جداول أو حضور الموظفين.`)} />)}</div>
        {filteredShifts.length === 0 && <div className="px-4 py-12 text-center"><Clock3 className="mx-auto h-5 w-5 text-muted" strokeWidth={1.7} /><p className="mt-2 text-sm font-medium text-text">لا توجد ورديات مطابقة</p><p className="mt-1 text-xs text-muted">جرّب تغيير كلمات البحث.</p></div>}
      </section>
    </main>
  );
}

function ShiftRow({ shift, onEdit }: { shift: ShiftPreview; onEdit: () => void }) { return <tr className="transition-colors hover:bg-background/70"><td className="px-4 py-4"><p className="font-medium text-text">{shift.name}</p><p className="mt-0.5 text-xs text-muted">{shift.period}</p></td><td className="px-4 py-4"><span className="num text-text" dir="ltr">{shift.start} — {shift.end}</span></td><td className="px-4 py-4"><span className="inline-flex items-center gap-1.5"><UsersRound className="h-4 w-4 text-muted" strokeWidth={1.7} /><span className="num text-text">{shift.employees}</span></span></td><td className="px-4 py-4 text-text">{shift.daysOff}</td><td className="px-4 py-4 text-end"><Button type="button" variant="outline" size="sm" onClick={onEdit}><Pencil className="h-3.5 w-3.5" strokeWidth={1.7} />تعديل</Button></td></tr>; }
function ShiftCard({ shift, onEdit }: { shift: ShiftPreview; onEdit: () => void }) { return <article className="space-y-3 px-4 py-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium text-text">{shift.name}</p><p className="mt-0.5 text-xs text-muted">{shift.period}</p></div><Button type="button" variant="outline" size="sm" onClick={onEdit}><Pencil className="h-3.5 w-3.5" strokeWidth={1.7} />تعديل</Button></div><div className="grid grid-cols-3 gap-3 border-t border-border pt-3 text-xs"><div><p className="text-muted">الوقت</p><p className="num mt-1 text-sm text-text" dir="ltr">{shift.start}–{shift.end}</p></div><div><p className="text-muted">الموظفون</p><p className="num mt-1 text-sm text-text">{shift.employees}</p></div><div><p className="text-muted">العطلات</p><p className="mt-1 text-sm text-text">{shift.daysOff}</p></div></div></article>; }
