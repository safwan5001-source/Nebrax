'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  FileText,
  Info,
  Plus,
  Save,
  Send,
  Trash2,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatRiyal } from '@/lib/money';

type PreviewLine = {
  id: number;
  product: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
};

const initialLines: PreviewLine[] = [
  {
    id: 1,
    product: 'اشتراك نبراس الاحترافي',
    description: 'اشتراك سنوي — 5 مستخدمين',
    quantity: 1,
    unitPrice: 2400,
    discount: 0,
    taxRate: 15,
  },
  {
    id: 2,
    product: 'جلسة تهيئة النظام',
    description: 'تهيئة أولية وتدريب فريق العمل',
    quantity: 2,
    unitPrice: 750,
    discount: 0,
    taxRate: 15,
  },
];

const customers = ['شركة الأفق للتجارة', 'مؤسسة مدار الأعمال', 'شركة أفق التقنية'];
const products = ['اشتراك نبراس الاحترافي', 'جلسة تهيئة النظام', 'دعم فني إضافي', 'خدمة استشارية'];

function lineNet(line: PreviewLine) {
  return Math.max(0, line.quantity * line.unitPrice - line.discount);
}

/**
 * نسخة واجهة معزولة لتقييم تصميم شاشة إنشاء فاتورة المبيعات.
 * تحفظ جميع الحالة محلياً داخل المتصفح ولا تُجري أي طلبات شبكة أو تغييرات محاسبية.
 */
export default function NewInvoicePreviewPage() {
  const router = useRouter();
  const [customer, setCustomer] = useState(customers[0]);
  const [paymentMethod, setPaymentMethod] = useState('credit');
  const [invoiceDate, setInvoiceDate] = useState('2026-08-14');
  const [dueDate, setDueDate] = useState('2026-08-29');
  const [notes, setNotes] = useState('شكراً لاختياركم نبراس. يرجى السداد خلال 15 يوماً من تاريخ الفاتورة.');
  const [lines, setLines] = useState<PreviewLine[]>(initialLines);
  const [previewMessage, setPreviewMessage] = useState('');

  const totals = useMemo(() => {
    const subtotal = lines.reduce((sum, line) => sum + lineNet(line), 0);
    const discount = lines.reduce((sum, line) => sum + line.discount, 0);
    const tax = lines.reduce((sum, line) => sum + (lineNet(line) * line.taxRate) / 100, 0);
    return { subtotal, discount, tax, total: subtotal + tax };
  }, [lines]);

  function updateLine(id: number, patch: Partial<PreviewLine>) {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((current) => [
      ...current,
      {
        id: Date.now(),
        product: '',
        description: '',
        quantity: 1,
        unitPrice: 0,
        discount: 0,
        taxRate: 15,
      },
    ]);
  }

  function removeLine(id: number) {
    setLines((current) => (current.length > 1 ? current.filter((line) => line.id !== id) : current));
  }

  function showPreviewMessage(message: string) {
    setPreviewMessage(message);
    window.setTimeout(() => setPreviewMessage(''), 4200);
  }

  return (
    <main className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted" aria-label="مسار التنقل">
        <button type="button" onClick={() => router.push('/invoices')} className="transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          المبيعات
        </button>
        <span aria-hidden="true">/</span>
        <button type="button" onClick={() => router.push('/invoices')} className="transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          الفواتير
        </button>
        <span aria-hidden="true">/</span>
        <span className="text-text">فاتورة مبيعات جديدة</span>
      </div>

      <div className="flex flex-wrap items-start gap-4 border-b border-border pb-4">
        <Button variant="ghost" size="icon" onClick={() => router.push('/invoices')} aria-label="العودة إلى الفواتير">
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-text">فاتورة مبيعات جديدة</h1>
            <span className="rounded border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">معاينة واجهة</span>
          </div>
          <p className="mt-1 text-sm text-muted">أنشئ فاتورة واضحة ومراجعة قبل الحفظ أو الترحيل.</p>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={() => router.push('/invoices')}>إلغاء</Button>
          <Button variant="outline" onClick={() => showPreviewMessage('تمت محاكاة حفظ المسودة محلياً. لم يتم إرسال أو حفظ أي بيانات.') }>
            <Save className="h-4 w-4" strokeWidth={1.7} />
            حفظ كمسودة
          </Button>
          <Button onClick={() => showPreviewMessage('زر ترحيل تجريبي فقط. لا يتم إنشاء فاتورة أو قيد محاسبي من هذه النسخة.') }>
            <Send className="h-4 w-4" strokeWidth={1.7} />
            ترحيل الفاتورة
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded border border-primary/20 bg-primary-soft px-3 py-2.5 text-sm text-text" role="note">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} aria-hidden="true" />
        <p>
          <strong>نسخة معزولة للتصميم فقط.</strong> تعمل الحقول والإجماليات داخل المتصفح لغرض المعاينة، ولا تتصل هذه الشاشة بواجهات إنشاء الفواتير أو ترحيلها أو القيود أو المخزون.
        </p>
      </div>

      {previewMessage && (
        <div className="rounded border border-positive/30 bg-positive/10 px-3 py-2.5 text-sm text-text" role="status" aria-live="polite">
          {previewMessage}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader className="border-b border-border pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4 text-primary" strokeWidth={1.8} />
                العميل وبيانات الفاتورة
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-1.5 xl:col-span-2">
                  <Label htmlFor="preview-customer">العميل <span className="text-negative">*</span></Label>
                  <Select id="preview-customer" value={customer} onChange={(event) => setCustomer(event.target.value)}>
                    {customers.map((name) => <option key={name} value={name}>{name}</option>)}
                  </Select>
                  <p className="text-xs text-muted">الرقم الضريبي: ٣١٠١٢٣٤٥٦٧٠٠٠٠٣</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="preview-number">رقم الفاتورة</Label>
                  <Input id="preview-number" value="سيُنشأ عند الحفظ" readOnly className="bg-background text-muted" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="preview-payment">طريقة السداد</Label>
                  <Select id="preview-payment" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
                    <option value="cash">نقدي</option>
                    <option value="credit">آجل — 15 يوماً</option>
                    <option value="transfer">تحويل بنكي</option>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="preview-invoice-date">تاريخ الفاتورة</Label>
                  <Input id="preview-invoice-date" type="date" dir="ltr" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="preview-due-date">تاريخ الاستحقاق</Label>
                  <Input id="preview-due-date" type="date" dir="ltr" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="preview-cost-center">مركز التكلفة</Label>
                  <Select id="preview-cost-center" defaultValue="sales">
                    <option value="sales">مبيعات — 210</option>
                    <option value="consulting">استشارات — 240</option>
                    <option value="general">غير محدد</option>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="preview-salesperson">مندوب المبيعات</Label>
                  <Select id="preview-salesperson" defaultValue="sara">
                    <option value="sara">سارة أحمد</option>
                    <option value="omar">عمر علي</option>
                    <option value="none">غير محدد</option>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-border pb-4">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-4 w-4 text-primary" strokeWidth={1.8} />
                  بنود الفاتورة
                </CardTitle>
                <p className="mt-1 text-xs font-normal text-muted">أضف المنتجات أو الخدمات، ثم راجع السعر والكمية والضريبة لكل بند.</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
                إضافة بند
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="hidden grid-cols-[minmax(180px,2fr)_minmax(140px,1.5fr)_88px_76px_88px_74px_110px_40px] items-center gap-2 border-b border-border bg-background px-4 py-2.5 text-xs font-medium text-muted lg:grid">
                <span>المنتج أو الخدمة</span>
                <span>الوصف</span>
                <span className="text-end">سعر الوحدة</span>
                <span className="text-end">الكمية</span>
                <span className="text-end">الخصم</span>
                <span className="text-end">الضريبة</span>
                <span className="text-end">الإجمالي</span>
                <span className="sr-only">إزالة</span>
              </div>

              <div className="divide-y divide-border">
                {lines.map((line) => {
                  const net = lineNet(line);
                  const lineTax = (net * line.taxRate) / 100;
                  return (
                    <div key={line.id} className="grid grid-cols-1 gap-3 px-4 py-4 lg:grid-cols-[minmax(180px,2fr)_minmax(140px,1.5fr)_88px_76px_88px_74px_110px_40px] lg:items-center lg:gap-2">
                      <div className="space-y-1 lg:space-y-0">
                        <Label className="text-xs text-muted lg:sr-only" htmlFor={`product-${line.id}`}>المنتج أو الخدمة</Label>
                        <Select id={`product-${line.id}`} value={line.product} onChange={(event) => updateLine(line.id, { product: event.target.value })}>
                          <option value="">بند يدوي</option>
                          {products.map((product) => <option key={product} value={product}>{product}</option>)}
                        </Select>
                      </div>
                      <div className="space-y-1 lg:space-y-0">
                        <Label className="text-xs text-muted lg:sr-only" htmlFor={`description-${line.id}`}>الوصف</Label>
                        <Input id={`description-${line.id}`} value={line.description} placeholder="وصف البند" onChange={(event) => updateLine(line.id, { description: event.target.value })} />
                      </div>
                      <div className="space-y-1 lg:space-y-0">
                        <Label className="text-xs text-muted lg:sr-only" htmlFor={`price-${line.id}`}>سعر الوحدة</Label>
                        <Input id={`price-${line.id}`} className="num text-end" type="number" min="0" step="0.01" inputMode="decimal" dir="ltr" value={line.unitPrice} onChange={(event) => updateLine(line.id, { unitPrice: Number(event.target.value) || 0 })} />
                      </div>
                      <div className="space-y-1 lg:space-y-0">
                        <Label className="text-xs text-muted lg:sr-only" htmlFor={`quantity-${line.id}`}>الكمية</Label>
                        <Input id={`quantity-${line.id}`} className="num text-end" type="number" min="1" step="1" inputMode="numeric" dir="ltr" value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: Math.max(1, Number(event.target.value) || 1) })} />
                      </div>
                      <div className="space-y-1 lg:space-y-0">
                        <Label className="text-xs text-muted lg:sr-only" htmlFor={`discount-${line.id}`}>الخصم</Label>
                        <Input id={`discount-${line.id}`} className="num text-end" type="number" min="0" step="0.01" inputMode="decimal" dir="ltr" value={line.discount || ''} placeholder="0" onChange={(event) => updateLine(line.id, { discount: Number(event.target.value) || 0 })} />
                      </div>
                      <div className="space-y-1 lg:space-y-0">
                        <Label className="text-xs text-muted lg:sr-only" htmlFor={`tax-${line.id}`}>الضريبة</Label>
                        <Select id={`tax-${line.id}`} className="num text-end" dir="ltr" value={line.taxRate} onChange={(event) => updateLine(line.id, { taxRate: Number(event.target.value) })}>
                          <option value="15">15%</option>
                          <option value="0">0%</option>
                        </Select>
                      </div>
                      <div className="flex items-center justify-between border-t border-border pt-2 lg:block lg:border-0 lg:pt-0 lg:text-end">
                        <span className="text-xs text-muted lg:sr-only">إجمالي البند</span>
                        <span className="num text-sm font-medium text-text">{formatRiyal(net + lineTax)}</span>
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="justify-self-end" aria-label="إزالة البند" onClick={() => removeLine(line.id)} disabled={lines.length === 1}>
                        <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
                      </Button>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <Button type="button" variant="ghost" size="sm" onClick={addLine}>
                  <Plus className="h-4 w-4" strokeWidth={1.7} />
                  إضافة بند آخر
                </Button>
                <span className="text-xs text-muted">{lines.length} بنود</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b border-border pb-4">
              <CardTitle className="text-base">ملاحظات وشروط السداد</CardTitle>
            </CardHeader>
            <CardContent className="pt-5">
              <Label htmlFor="preview-notes">ملاحظات ستظهر للعميل</Label>
              <textarea
                id="preview-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
                className="mt-1.5 min-h-24 w-full resize-y rounded border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                placeholder="أضف ملاحظة أو شرط سداد"
              />
            </CardContent>
          </Card>
        </div>

        <aside className="xl:sticky xl:top-4 xl:self-start">
          <Card>
            <CardHeader className="border-b border-border pb-4">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base">ملخص الفاتورة</CardTitle>
                <span className="rounded border border-border bg-background px-2 py-0.5 text-xs text-muted">ر.س</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 pt-5 text-sm">
              <div className="flex items-center justify-between text-muted">
                <span>إجمالي البنود</span>
                <span className="num text-text">{formatRiyal(totals.subtotal + totals.discount)}</span>
              </div>
              <div className="flex items-center justify-between text-muted">
                <span>الخصم</span>
                <span className="num text-positive">−{formatRiyal(totals.discount)}</span>
              </div>
              <div className="flex items-center justify-between text-muted">
                <span>ضريبة القيمة المضافة</span>
                <span className="num text-text">{formatRiyal(totals.tax)}</span>
              </div>
              <div className="border-t border-border pt-3">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="font-semibold text-text">الإجمالي المستحق</p>
                    <p className="mt-0.5 text-xs text-muted">شامل ضريبة القيمة المضافة</p>
                  </div>
                  <span className="num text-2xl font-bold text-primary">{formatRiyal(totals.total)}</span>
                </div>
              </div>
              <div className="border-t border-border pt-4">
                <p className="text-xs font-medium text-text">حالة المعاينة</p>
                <p className="mt-1.5 text-xs leading-5 text-muted">الإجماليات لحظية داخل الواجهة. لن تُحفظ الفاتورة أو تُرحّل أو يُنشأ عنها أثر محاسبي من هذه الصفحة.</p>
              </div>
              <div className="grid gap-2 pt-1">
                <Button onClick={() => showPreviewMessage('تمت تجربة مسار الحفظ داخل الواجهة فقط — دون إنشاء مسودة فعلية.') }>
                  <Save className="h-4 w-4" strokeWidth={1.7} />
                  تجربة حفظ المسودة
                </Button>
                <Button variant="outline" onClick={() => showPreviewMessage('تمت تجربة مسار الترحيل داخل الواجهة فقط — دون أي قيد أو أثر فعلي.') }>
                  <Send className="h-4 w-4" strokeWidth={1.7} />
                  تجربة ترحيل الفاتورة
                </Button>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}
