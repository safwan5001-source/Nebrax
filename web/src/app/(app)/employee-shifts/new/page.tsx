'use client';

import { FormEvent, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarDays, Clock3, Info, Save, ShieldCheck, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const weekDays = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** معاينة نموذج الوردية؛ يبقى كل إدخال محلياً ولا ينشئ دواماً أو جدول حضور. */
export default function NewEmployeeShiftPreviewPage() {
  const [name, setName] = useState('');
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('16:00');
  const [breakMinutes, setBreakMinutes] = useState('30');
  const [daysOff, setDaysOff] = useState<string[]>(['الجمعة', 'السبت']);
  const [workingDays, setWorkingDays] = useState<string[]>(['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس']);
  const [assignedBranch, setAssignedBranch] = useState('');
  const [notice, setNotice] = useState('');

  const workingHours = useMemo(() => {
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);
    const rawMinutes = (endHour * 60 + endMinute) - (startHour * 60 + startMinute) - (Number(breakMinutes) || 0);
    const minutes = rawMinutes > 0 ? rawMinutes : 0;
    return `${Math.floor(minutes / 60)} س ${minutes % 60} د`;
  }, [breakMinutes, endTime, startTime]);

  function toggleDay(day: string, target: 'work' | 'off') {
    const setTarget = target === 'work' ? setWorkingDays : setDaysOff;
    const other = target === 'work' ? daysOff : workingDays;
    setTarget((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day]);
    if (!other.includes(day)) return;
    if (target === 'work') setDaysOff((current) => current.filter((item) => item !== day));
    else setWorkingDays((current) => current.filter((item) => item !== day));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(`تمت محاكاة حفظ وردية «${name || 'جديدة'}» داخل المتصفح فقط. لا يُنشأ جدول دوام أو يُربط أي موظف أو سجل حضور.`);
  }

  return (
    <main className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted" aria-label="مسار التنقل"><Link href="/employee-shifts" className="transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">الورديات</Link><span aria-hidden="true">/</span><span className="text-text">إضافة وردية</span></div>
      <div className="flex flex-wrap items-start gap-4 border-b border-border pb-4"><Link href="/employee-shifts" className="inline-flex h-9 w-9 items-center justify-center rounded text-muted transition-colors hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label="العودة إلى الورديات"><ArrowRight className="h-4 w-4" strokeWidth={1.7} /></Link><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold text-text">إضافة وردية</h1><span className="rounded border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">معاينة واجهة</span></div><p className="mt-1 text-sm text-muted">حدّد أوقات العمل وأيام العطلات لتقييم النموذج، من دون إنشاء جدول فعلي.</p></div><div className="ms-auto flex gap-2"><Link href="/employee-shifts" className="inline-flex h-9 items-center justify-center rounded px-3 text-sm font-medium text-muted transition-colors hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">إلغاء</Link><Button type="submit" form="shift-preview-form"><Save className="h-4 w-4" strokeWidth={1.7} />حفظ للمعاينة</Button></div></div>
      <section className="rounded border border-primary/20 bg-primary-soft px-3 py-2.5"><div className="flex items-start gap-2 text-sm text-text"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} /><p><strong>لا أثر فعلي.</strong> لا تُنشئ هذه الصفحة وردية، ولا تعدّل الحضور أو الإجازات أو ربط الموظفين بالفروع.</p></div></section>
      {notice && <div className="rounded border border-positive/30 bg-positive/10 px-3 py-2.5 text-sm text-text" role="status" aria-live="polite">{notice}</div>}

      <form id="shift-preview-form" onSubmit={submit} className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-5">
          <Card><CardHeader className="border-b border-border pb-4"><CardTitle className="flex items-center gap-2 text-base"><Clock3 className="h-4 w-4 text-primary" strokeWidth={1.8} />بيانات الوردية</CardTitle><p className="pt-1 text-xs font-normal text-muted">حدد تسمية الوردية وموقعها في المعاينة.</p></CardHeader><CardContent className="pt-5"><div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Field label="اسم الوردية" htmlFor="shift-name" required><Input id="shift-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="مثال: الوردية الصباحية #1" required /></Field><Field label="الفرع" htmlFor="shift-branch"><Select id="shift-branch" value={assignedBranch} onChange={(event) => setAssignedBranch(event.target.value)}><option value="">كل الفروع — معاينة</option><option>الفرع الرئيسي</option><option>فرع المبيعات</option><option>فرع المستودع</option></Select></Field></div></CardContent></Card>

          <Card><CardHeader className="border-b border-border pb-4"><CardTitle className="flex items-center gap-2 text-base"><Clock3 className="h-4 w-4 text-primary" strokeWidth={1.8} />ساعات العمل</CardTitle><p className="pt-1 text-xs font-normal text-muted">يظهر الحساب كتقدير بصري محلي بعد خصم الاستراحة.</p></CardHeader><CardContent className="pt-5"><div className="grid grid-cols-1 gap-4 sm:grid-cols-3"><Field label="بداية الوردية" htmlFor="shift-start" required><Input id="shift-start" type="time" dir="ltr" value={startTime} onChange={(event) => setStartTime(event.target.value)} required /></Field><Field label="نهاية الوردية" htmlFor="shift-end" required><Input id="shift-end" type="time" dir="ltr" value={endTime} onChange={(event) => setEndTime(event.target.value)} required /></Field><Field label="مدة الاستراحة بالدقائق" htmlFor="shift-break"><Input id="shift-break" type="number" min="0" dir="ltr" className="num" value={breakMinutes} onChange={(event) => setBreakMinutes(event.target.value)} /></Field></div><div className="mt-4 flex items-center justify-between rounded border border-border bg-background px-3 py-2.5 text-sm"><span className="text-muted">ساعات العمل الصافية للمعاينة</span><span className="num font-semibold text-text">{workingHours}</span></div></CardContent></Card>

          <Card><CardHeader className="border-b border-border pb-4"><CardTitle className="flex items-center gap-2 text-base"><CalendarDays className="h-4 w-4 text-primary" strokeWidth={1.8} />أيام العمل والعطلات</CardTitle><p className="pt-1 text-xs font-normal text-muted">يتحرك اليوم بين القائمتين محلياً كي لا يكون يوم العمل والعطلة في آن واحد.</p></CardHeader><CardContent className="grid grid-cols-1 gap-5 pt-5 md:grid-cols-2"><DaySelector title="أيام العمل" description="الأيام المدرجة ضمن الوردية" days={workingDays} target="work" onToggle={toggleDay} /><DaySelector title="أيام العطلات" description="أيام الراحة للوردية" days={daysOff} target="off" onToggle={toggleDay} /></CardContent></Card>

          <Card><CardHeader className="border-b border-border pb-4"><CardTitle className="flex items-center gap-2 text-base"><UsersRound className="h-4 w-4 text-primary" strokeWidth={1.8} />ربط الموظفين</CardTitle></CardHeader><CardContent className="pt-5"><div className="flex items-start gap-2 rounded border border-border bg-background px-3 py-3 text-sm text-muted"><Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.7} /><p>يُربط الموظفون بالوردية في مرحلة لاحقة. هذه المعاينة لا تعرض أو تغير أي موظف أو سجل حضور.</p></div></CardContent></Card>
        </div>

        <aside className="xl:sticky xl:top-4 xl:self-start"><Card><CardHeader className="border-b border-border pb-4"><CardTitle className="text-base">ملخص المعاينة</CardTitle></CardHeader><CardContent className="space-y-4 pt-5 text-sm"><SummaryLine label="اسم الوردية" value={name || 'وردية جديدة'} /><SummaryLine label="الوقت" value={`${startTime} — ${endTime}`} numeric /><SummaryLine label="الساعات الصافية" value={workingHours} /><SummaryLine label="العطلات" value={daysOff.length ? daysOff.join('، ') : 'لم تُحدد'} /><SummaryLine label="الفرع" value={assignedBranch || 'كل الفروع — معاينة'} /><div className="border-t border-border pt-4"><p className="text-xs font-medium text-text">حدود الصفحة</p><p className="mt-1.5 text-xs leading-5 text-muted">الحفظ يحاكي النتيجة داخل الواجهة فقط، من دون جدول أو حضور أو بيانات موظفين.</p></div><Button type="submit" form="shift-preview-form" className="w-full"><Save className="h-4 w-4" strokeWidth={1.7} />حفظ للمعاينة</Button></CardContent></Card></aside>
      </form>
    </main>
  );
}

function DaySelector({ title, description, days, target, onToggle }: { title: string; description: string; days: string[]; target: 'work' | 'off'; onToggle: (day: string, target: 'work' | 'off') => void }) { return <section><div className="mb-3"><h3 className="font-medium text-text">{title}</h3><p className="mt-0.5 text-xs text-muted">{description}</p></div><div className="flex flex-wrap gap-2">{weekDays.map((day) => { const active = days.includes(day); return <button key={day} type="button" onClick={() => onToggle(day, target)} aria-pressed={active} className={cn('rounded border px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40', active ? target === 'work' ? 'border-primary/30 bg-primary-soft font-medium text-primary' : 'border-warning/30 bg-warning/10 font-medium text-warning' : 'border-border bg-surface text-muted hover:bg-background')}>{day}</button>; })}</div></section>; }
function Field({ label, htmlFor, required, children }: { label: string; htmlFor: string; required?: boolean; children: React.ReactNode }) { return <div className="space-y-1.5"><Label htmlFor={htmlFor}>{label}{required && <span className="text-negative"> *</span>}</Label>{children}</div>; }
function SummaryLine({ label, value, numeric }: { label: string; value: string; numeric?: boolean }) { return <div className="flex items-start justify-between gap-3"><span className="text-muted">{label}</span><span className={cn('text-end text-text', numeric && 'num')} dir={numeric ? 'ltr' : undefined}>{value}</span></div>; }
