'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BriefcaseBusiness,
  ChevronLeft,
  CircleUserRound,
  FileUp,
  Info,
  Save,
  ShieldCheck,
  UserRoundPlus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

type FormState = {
  firstName: string;
  middleName: string;
  lastName: string;
  recordType: 'employee' | 'user';
  employeeCode: string;
  workEmail: string;
  personalEmail: string;
  jobTitle: string;
  department: string;
  employmentType: string;
  level: string;
  branch: string;
  role: string;
  manager: string;
  hireDate: string;
  birthDate: string;
  gender: string;
  nationality: string;
  residencyStatus: string;
  identityNumber: string;
  mobile: string;
  phone: string;
  currentAddress: string;
  permanentAddress: string;
  primaryShift: string;
  leavePolicy: string;
  attendanceRule: string;
  notes: string;
  allowLogin: boolean;
  sendCredentials: boolean;
};

const initialForm: FormState = {
  firstName: '',
  middleName: '',
  lastName: '',
  recordType: 'employee',
  employeeCode: 'EMP-1043',
  workEmail: '',
  personalEmail: '',
  jobTitle: '',
  department: '',
  employmentType: 'دوام كامل',
  level: '',
  branch: '',
  role: '',
  manager: '',
  hireDate: '',
  birthDate: '',
  gender: '',
  nationality: 'السعودية',
  residencyStatus: '',
  identityNumber: '',
  mobile: '',
  phone: '',
  currentAddress: '',
  permanentAddress: '',
  primaryShift: '',
  leavePolicy: '',
  attendanceRule: '',
  notes: '',
  allowLogin: false,
  sendCredentials: false,
};

/**
 * معاينة نموذج إضافة مستخدم أو موظف.
 * تبقى الحالة في الذاكرة فقط؛ لا يوجد اتصال API أو رفع ملف أو حفظ لبيانات شخصية.
 */
export default function NewEmployeePreviewPage() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [notice, setNotice] = useState('');
  const [selectedFile, setSelectedFile] = useState('');

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice('تمت محاكاة حفظ السجل داخل المتصفح فقط. لا تُنشأ أي بيانات موظف أو مستخدم، ولا تُرسل بيانات دخول أو مرفقات.');
  }

  return (
    <main className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted" aria-label="مسار التنقل">
        <Link href="/employee-management" className="transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">إدارة الموظفين</Link>
        <span aria-hidden="true">/</span>
        <span className="text-text">إضافة مستخدم أو موظف</span>
      </div>

      <div className="flex flex-wrap items-start gap-4 border-b border-border pb-4">
        <Link href="/employee-management" className="inline-flex h-9 w-9 items-center justify-center rounded text-muted transition-colors hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label="العودة إلى إدارة الموظفين">
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Link>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-text">إضافة مستخدم أو موظف</h1>
            <span className="rounded border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">معاينة واجهة</span>
          </div>
          <p className="mt-1 text-sm text-muted">نموذج شامل مستوحى من المرجع، مع حفظ محلي محاكى فقط.</p>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Link href="/employee-management" className="inline-flex h-9 items-center justify-center rounded px-3 text-sm font-medium text-muted transition-colors hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">إلغاء</Link>
          <Button type="submit" form="employee-preview-form"><Save className="h-4 w-4" strokeWidth={1.7} />حفظ للمعاينة</Button>
        </div>
      </div>

      <section className="rounded border border-primary/20 bg-primary-soft px-3 py-2.5" aria-label="نطاق المعاينة">
        <div className="flex items-start gap-2 text-sm text-text">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} aria-hidden="true" />
          <p><strong>لا أثر فعلي.</strong> الحقول والمرفقات وإعدادات الدخول في هذه الصفحة لا تُرسل أو تُخزن أو تُشارك مع أي خدمة.</p>
        </div>
      </section>

      {notice && <div className="rounded border border-positive/30 bg-positive/10 px-3 py-2.5 text-sm text-text" role="status" aria-live="polite">{notice}</div>}

      <form id="employee-preview-form" onSubmit={submit} className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-5">
          <FormSection icon={CircleUserRound} title="المعلومات العامة" description="حدّد هوية السجل وطريقة ظهوره في دليل الموظفين.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="الاسم الأول" htmlFor="first-name" required><Input id="first-name" value={form.firstName} onChange={(e) => update('firstName', e.target.value)} required /></Field>
              <Field label="الاسم الأوسط" htmlFor="middle-name"><Input id="middle-name" value={form.middleName} onChange={(e) => update('middleName', e.target.value)} /></Field>
              <Field label="اسم العائلة" htmlFor="last-name" required><Input id="last-name" value={form.lastName} onChange={(e) => update('lastName', e.target.value)} required /></Field>
              <Field label="نوع السجل" htmlFor="record-type" required><Select id="record-type" value={form.recordType} onChange={(e) => update('recordType', e.target.value as FormState['recordType'])}><option value="employee">موظف</option><option value="user">مستخدم</option></Select></Field>
              <Field label="الكود" htmlFor="employee-code" required><Input id="employee-code" dir="ltr" className="num" value={form.employeeCode} onChange={(e) => update('employeeCode', e.target.value)} required /></Field>
              <Field label="البريد الإلكتروني للعمل" htmlFor="work-email"><Input id="work-email" type="email" dir="ltr" value={form.workEmail} onChange={(e) => update('workEmail', e.target.value)} placeholder="name@example.test" /></Field>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 rounded border border-border bg-background p-3 sm:grid-cols-2">
              <ToggleField id="allow-login" checked={form.allowLogin} onChange={(checked) => update('allowLogin', checked)} label="السماح بالدخول إلى النظام" description="إعداد مرئي في المعاينة ولا ينشئ حساب دخول." />
              <ToggleField id="send-credentials" checked={form.sendCredentials} onChange={(checked) => update('sendCredentials', checked)} label="إرسال بيانات الدخول بالبريد" description="لا يُرسل أي بريد في وضع المعاينة." />
            </div>
            {form.recordType === 'user' && <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted"><Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.7} />نوع «مستخدم» يُعرض لتجربة النموذج فقط؛ لا تتغير الصلاحيات ولا تُنشأ حسابات من هذه الصفحة.</p>}
          </FormSection>

          <FormSection icon={FileUp} title="الصورة والملاحظات" description="يمكن اختيار ملف محلي للمعاينة؛ لا يُرفع أو يُخزن.">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <div className="rounded border border-dashed border-border bg-background p-4">
                <Label htmlFor="employee-photo">صورة الموظف</Label>
                <input id="employee-photo" type="file" accept="image/*" onChange={(event) => setSelectedFile(event.target.files?.[0]?.name ?? '')} className="mt-2 block w-full text-sm text-muted file:me-3 file:rounded file:border-0 file:bg-primary-soft file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary" />
                <p className="mt-2 text-xs text-muted">{selectedFile ? `تم اختيار: ${selectedFile}` : 'لم يُختر ملف — يظل محلياً داخل المتصفح.'}</p>
              </div>
              <Field label="ملاحظات" htmlFor="notes"><textarea id="notes" value={form.notes} onChange={(e) => update('notes', e.target.value)} rows={4} className="min-h-24 w-full resize-y rounded border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" placeholder="أضف ملاحظة داخلية للمعاينة" /></Field>
            </div>
          </FormSection>

          <FormSection icon={CircleUserRound} title="المعلومات الشخصية" description="تظهر لتقييم ترتيب النموذج فقط ولا تُحتفظ بياناتها.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="تاريخ الميلاد" htmlFor="birth-date"><Input id="birth-date" type="date" dir="ltr" value={form.birthDate} onChange={(e) => update('birthDate', e.target.value)} /></Field>
              <Field label="النوع" htmlFor="gender"><Select id="gender" value={form.gender} onChange={(e) => update('gender', e.target.value)}><option value="">اختر النوع</option><option>ذكر</option><option>أنثى</option></Select></Field>
              <Field label="الجنسية" htmlFor="nationality"><Input id="nationality" value={form.nationality} onChange={(e) => update('nationality', e.target.value)} /></Field>
              <Field label="حالة المواطنة" htmlFor="residency-status"><Select id="residency-status" value={form.residencyStatus} onChange={(e) => update('residencyStatus', e.target.value)}><option value="">اختر الحالة</option><option>مواطن</option><option>مقيم</option></Select></Field>
              <Field label="رقم الهوية أو الإقامة" htmlFor="identity-number"><Input id="identity-number" dir="ltr" className="num" value={form.identityNumber} onChange={(e) => update('identityNumber', e.target.value)} /></Field>
              <Field label="البريد الشخصي" htmlFor="personal-email"><Input id="personal-email" type="email" dir="ltr" value={form.personalEmail} onChange={(e) => update('personalEmail', e.target.value)} placeholder="name@example.test" /></Field>
            </div>
          </FormSection>

          <FormSection icon={BriefcaseBusiness} title="معلومات العمل" description="اختر بيانات العمل والسياسات كمعاينة للواجهة فقط.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="المسمى الوظيفي" htmlFor="job-title"><Input id="job-title" value={form.jobTitle} onChange={(e) => update('jobTitle', e.target.value)} placeholder="مثال: أخصائي مبيعات" /></Field>
              <Field label="القسم" htmlFor="department"><Select id="department" value={form.department} onChange={(e) => update('department', e.target.value)}><option value="">اختر القسم</option><option>المبيعات</option><option>الحسابات</option><option>الموارد البشرية</option><option>التشغيل والعمليات</option></Select></Field>
              <Field label="نوع الوظيفة" htmlFor="employment-type"><Select id="employment-type" value={form.employmentType} onChange={(e) => update('employmentType', e.target.value)}><option>دوام كامل</option><option>دوام جزئي</option><option>تعاقد</option></Select></Field>
              <Field label="المستوى الوظيفي" htmlFor="job-level"><Select id="job-level" value={form.level} onChange={(e) => update('level', e.target.value)}><option value="">اختر المستوى</option><option>مبتدئ</option><option>متوسط</option><option>إشرافي</option><option>إداري</option></Select></Field>
              <Field label="الفرع" htmlFor="branch" required><Select id="branch" value={form.branch} onChange={(e) => update('branch', e.target.value)} required><option value="">اختر الفرع</option><option>الفرع الرئيسي</option><option>فرع المبيعات</option><option>فرع المستودع</option></Select></Field>
              <Field label="الدور الوظيفي" htmlFor="role"><Select id="role" value={form.role} onChange={(e) => update('role', e.target.value)}><option value="">اختر الدور</option><option>موظف</option><option>مشرف</option><option>مدير قسم</option></Select></Field>
              <Field label="تاريخ الالتحاق" htmlFor="hire-date"><Input id="hire-date" type="date" dir="ltr" value={form.hireDate} onChange={(e) => update('hireDate', e.target.value)} /></Field>
              <Field label="المدير المباشر" htmlFor="manager"><Select id="manager" value={form.manager} onChange={(e) => update('manager', e.target.value)}><option value="">اختر الموظف</option><option>مدير المبيعات — معاينة</option><option>مدير العمليات — معاينة</option></Select></Field>
              <Field label="وردية الحجز" htmlFor="booking-shift"><Select id="booking-shift"><option>اختر وردية</option><option>صباحية — معاينة</option><option>مسائية — معاينة</option></Select></Field>
            </div>
          </FormSection>

          <FormSection icon={UserRoundPlus} title="التواصل والعناوين" description="حقول لتنظيم نموذج الإضافة، من دون حفظ أي بيانات اتصال أو عنوان.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="رقم الجوال" htmlFor="mobile"><Input id="mobile" dir="ltr" inputMode="tel" className="num" value={form.mobile} onChange={(e) => update('mobile', e.target.value)} placeholder="05XXXXXXXX" /></Field>
              <Field label="رقم الهاتف" htmlFor="phone"><Input id="phone" dir="ltr" inputMode="tel" className="num" value={form.phone} onChange={(e) => update('phone', e.target.value)} /></Field>
              <div className="hidden xl:block" aria-hidden="true" />
              <Field label="العنوان الحالي" htmlFor="current-address"><Input id="current-address" value={form.currentAddress} onChange={(e) => update('currentAddress', e.target.value)} placeholder="المدينة، الحي، الشارع" /></Field>
              <Field label="العنوان الدائم" htmlFor="permanent-address"><Input id="permanent-address" value={form.permanentAddress} onChange={(e) => update('permanentAddress', e.target.value)} placeholder="المدينة، الحي، الشارع" /></Field>
            </div>
          </FormSection>

          <FormSection icon={ShieldCheck} title="الحضور والسياسات" description="إعدادات مرئية للمعاينة ولا تُنشئ ورديات أو سياسات أو قيود حضور.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="الوردية الأساسية" htmlFor="primary-shift"><Select id="primary-shift" value={form.primaryShift} onChange={(e) => update('primaryShift', e.target.value)}><option value="">اختر الوردية الأساسية</option><option>صباحية — معاينة</option><option>مسائية — معاينة</option></Select></Field>
              <Field label="سياسة الإجازات" htmlFor="leave-policy"><Select id="leave-policy" value={form.leavePolicy} onChange={(e) => update('leavePolicy', e.target.value)}><option value="">اختر سياسة الإجازات</option><option>السياسة العامة — معاينة</option></Select></Field>
              <Field label="محددات الحضور" htmlFor="attendance-rule"><Select id="attendance-rule" value={form.attendanceRule} onChange={(e) => update('attendanceRule', e.target.value)}><option value="">اختر قيد الحضور</option><option>ساعات عمل المكتب — معاينة</option></Select></Field>
            </div>
          </FormSection>
        </div>

        <aside className="xl:sticky xl:top-4 xl:self-start">
          <Card>
            <CardHeader className="border-b border-border pb-4"><CardTitle className="text-base">ملخص المعاينة</CardTitle></CardHeader>
            <CardContent className="space-y-4 pt-5 text-sm">
              <div className="space-y-2">
                <SummaryLine label="نوع السجل" value={form.recordType === 'user' ? 'مستخدم' : 'موظف'} />
                <SummaryLine label="الاسم" value={[form.firstName, form.middleName, form.lastName].filter(Boolean).join(' ') || 'لم يُدخل بعد'} />
                <SummaryLine label="الفرع" value={form.branch || 'غير محدد'} />
                <SummaryLine label="الدخول للنظام" value={form.allowLogin ? 'معروض للمعاينة' : 'غير مفعّل'} />
              </div>
              <div className="border-t border-border pt-4">
                <p className="text-xs font-medium text-text">حدود هذه الصفحة</p>
                <p className="mt-1.5 text-xs leading-5 text-muted">زر الحفظ يحدّث رسالة نجاح محلية فقط. لا تُنشأ سجلات، ولا تُرفع ملفات، ولا تُرسل بيانات دخول أو بريد.</p>
              </div>
              <Button type="submit" form="employee-preview-form" className="w-full"><Save className="h-4 w-4" strokeWidth={1.7} />حفظ للمعاينة</Button>
              <Link href="/employee-management" className="inline-flex h-9 w-full items-center justify-center rounded border border-border px-3 text-sm font-medium text-text transition-colors hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">العودة إلى القائمة</Link>
            </CardContent>
          </Card>
        </aside>
      </form>
    </main>
  );
}

function FormSection({ icon: Icon, title, description, children }: { icon: typeof CircleUserRound; title: string; description: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="border-b border-border pb-4">
        <CardTitle className="flex items-center gap-2 text-base"><Icon className="h-4 w-4 text-primary" strokeWidth={1.8} />{title}</CardTitle>
        <p className="pt-1 text-xs font-normal leading-5 text-muted">{description}</p>
      </CardHeader>
      <CardContent className="pt-5">{children}</CardContent>
    </Card>
  );
}

function Field({ label, htmlFor, required, children }: { label: string; htmlFor: string; required?: boolean; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label htmlFor={htmlFor}>{label}{required && <span className="text-negative"> *</span>}</Label>{children}</div>;
}

function ToggleField({ id, checked, onChange, label, description }: { id: string; checked: boolean; onChange: (checked: boolean) => void; label: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary" />
      <div><Label htmlFor={id} className="cursor-pointer text-sm font-medium text-text">{label}</Label><p className="mt-0.5 text-xs leading-5 text-muted">{description}</p></div>
    </div>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-3"><span className="text-muted">{label}</span><span className={cn('text-end text-text', value === 'لم يُدخل بعد' && 'text-muted')}>{value}</span></div>;
}
