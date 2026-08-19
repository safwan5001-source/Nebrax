'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowRight, Banknote, CheckCircle2, ChevronDown, Download,
  FileSpreadsheet, LayoutTemplate, MoreVertical, Pencil, Printer,
  RotateCcw, Share2, Trash2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog } from '@/components/ui/dialog';
import { Dropdown, DropdownItem } from '@/components/ui/dropdown';
import { useToast } from '@/components/ui/toast';
import { InvoiceDocument, type Company, type Customer } from '@/components/invoices/invoice-document';
import { PaymentDialog } from '@/components/payments/payment-dialog';
import { CreateReturnDialog } from '@/components/returns/create-return-dialog';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { documentExporter, printDocument } from '@/modules/documents/services/export';
import { getTemplate, listTemplates, DEFAULT_TEMPLATE_ID } from '@/modules/documents/registry/templates';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import { RevisionLog } from '@/components/documents/revision-log';
import type { ThemeId, DocSectionLayoutItem } from '@/modules/documents/types';
import { PAPER_SIZES } from '@/modules/documents/constants/paper';
import { exportXlsx } from '@/lib/xlsx';
import { resolveLiveTemplateDefinition, type LivePrintTemplateAssignment } from '@/modules/print-templates/services/live-template-definition';

interface Line {
  id: string;
  product_name: string | null;
  product_code: string | null;
  barcode: string | null;
  description: string | null;
  quantity: number;
  unit_price: string;
  unit_price_before_tax: string;
  tax_rate: number;
  line_subtotal: string;
  line_tax: string;
  line_total: string;
}
interface FrozenPrintTemplateRevision {
  id: string;
  version: number;
  definition: {
    template_id?: string;
    theme_id?: ThemeId;
    footer_text?: string;
    show_logo?: boolean;
    layout?: DocSectionLayoutItem[];
    terms_text?: string;
    bank_text?: string;
    stamp?: string;
    signature?: string;
  };
  document_types: string[];
}
interface Invoice {
  id: string;
  branch_id: string | null;
  number: string;
  partner_id: string;
  payment_type: string;
  status: string;
  payment_status: string;
  invoice_date: string;
  due_date: string | null;
  subtotal: string;
  discount: string;
  shipping: string;
  adjustment: string;
  tax_amount: string;
  total: string;
  paid_amount: string;
  remaining: string;
  notes: string | null;
  lines: Line[];
  print_template_revision_id?: string | null;
  print_template_revision?: FrozenPrintTemplateRevision | null;
  pdf_template_revision_id?: string | null;
  pdf_template_revision?: FrozenPrintTemplateRevision | null;
  thermal_template_revision_id?: string | null;
  thermal_template_revision?: FrozenPrintTemplateRevision | null;
}
interface Zatca {
  qr: string | null;
  hash: string | null;
  uuid: string | null;
  icv: number | null;
}
type PendingAction = 'post' | 'delete' | null;
type ExportBusy = 'pdf' | 'share' | 'excel' | null;

const statusTone: Record<string, 'positive' | 'muted' | 'negative'> = {
  posted: 'positive',
  draft: 'muted',
  cancelled: 'negative',
};
const payTone: Record<string, 'positive' | 'warning' | 'muted'> = {
  paid: 'positive',
  partial: 'warning',
  unpaid: 'muted',
};

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('invoiceDetail');
  const ti = useTranslations('invoices');
  const ts = useTranslations('status');
  const tPrint = useTranslations('documentPrint');
  const locale = useLocale();
  const { success, error: errorToast } = useToast();

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [zatca, setZatca] = useState<Zatca | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<ExportBusy>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [actioning, setActioning] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [templateId, setTemplateId] = useState<string>(DEFAULT_TEMPLATE_ID);
  const [themeId, setThemeId] = useState<ThemeId | null>(null);
  const [footerText, setFooterText] = useState<string | null>(null);
  const [showLogo, setShowLogo] = useState(true);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoHeight, setLogoHeight] = useState<number | null>(null);
  const [layout, setLayout] = useState<DocSectionLayoutItem[] | null>(null);
  const [termsText, setTermsText] = useState<string | null>(null);
  const [bankText, setBankText] = useState<string | null>(null);
  const [stampUrl, setStampUrl] = useState<string | null>(null);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const tt = useTranslations('invoiceTemplates');

  const partnerName = customer?.name ?? '—';
  const isDraft = invoice?.status === 'draft';
  const isPosted = invoice?.status === 'posted';
  const canCollect = isPosted && invoice?.payment_status !== 'paid';

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    api<{ data: Invoice }>(`/invoices/${id}`)
      .then(async (r) => {
        setInvoice(r.data);
        const branchQuery = r.data.branch_id ? `&branch_id=${encodeURIComponent(r.data.branch_id)}` : '';
        const [p, z, m, live] = await Promise.allSettled([
          api<{ data: Customer }>(`/partners/${r.data.partner_id}`),
          api<Zatca>(`/invoices/${id}/zatca`),
          api<{ company: Company }>(`/me`),
          api<{ data: LivePrintTemplateAssignment | null }>(`/print-templates/resolve?document_type=tax_invoice&usage=print${branchQuery}`),
        ]);
        if (p.status === 'fulfilled') setCustomer(p.value.data);
        if (z.status === 'fulfilled') setZatca(z.value);
        if (m.status === 'fulfilled') setCompany(m.value.company);

        // الفاتورة المرحّلة تقرأ مراجعتها المثبّتة حصراً؛ لا يعيد تعديل القالب أو
        // إعدادات الهوية تفسير مستند تاريخي. المسودات والبيانات القديمة تستخدم
        // إعدادات التوافق الحية إلى أن تصدر.
        const frozen = r.data.print_template_revision?.definition;
        if (frozen) {
          setTemplateId(frozen.template_id ?? DEFAULT_TEMPLATE_ID);
          setThemeId(frozen.theme_id ?? null);
          setFooterText(frozen.footer_text ?? null);
          setShowLogo(frozen.show_logo !== false);
          setLayout(Array.isArray(frozen.layout) && frozen.layout.length ? frozen.layout : null);
          setLogoUrl(null);
          setLogoHeight(null);
          setTermsText(frozen.terms_text ?? null);
          setBankText(frozen.bank_text ?? null);
          setStampUrl(null);
          setSignatureUrl(null);
        } else {
          const resolved = live.status === 'fulfilled'
            ? resolveLiveTemplateDefinition(live.value.data, 'tax_invoice')
            : null;
          if (resolved) {
            setTemplateId(resolved.templateId);
            setThemeId(resolved.themeId);
            setFooterText(resolved.footerText);
            setShowLogo(resolved.showLogo);
            setLogoUrl(null);
            setLogoHeight(resolved.logoHeight);
            setLayout(resolved.layout);
            setTermsText(resolved.termsText);
            setBankText(resolved.bankText);
            setStampUrl(resolved.stampUrl);
            setSignatureUrl(resolved.signatureUrl);
          }
        }
      })
      .catch(() => setLoadError(true)) // فشل التحميل ≠ سجل غير موجود (تمييز الخطأ عن الغياب)
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => load(), [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded border border-border bg-surface p-8 text-center">
        <p className="text-sm text-negative">{t('load_error')}</p>
        <Button variant="outline" className="mt-3" onClick={load}>{t('retry')}</Button>
      </div>
    );
  }

  if (!invoice) return <div className="text-muted">{t('not_found')}</div>;

  const info: [string, React.ReactNode][] = [
    [t('partner'), customer ? <Link href={`/partners/${invoice.partner_id}`} className="text-primary hover:underline">{partnerName}</Link> : partnerName],
    [t('date'), <span key="date" className="num">{invoice.invoice_date}</span>],
    [t('due_date'), <span key="due" className="num">{invoice.due_date ?? '—'}</span>],
    [t('payment_type'), invoice.payment_type === 'cash' ? t('cash') : t('credit')],
    [t('paid'), <span key="paid" className="num font-medium">{formatRiyal(invoice.paid_amount)}</span>],
    [t('remaining'), <span key="remaining" className="num font-semibold">{formatRiyal(invoice.remaining)}</span>],
  ];
  const financialSummary: [string, string, boolean][] = [
    [t('subtotal'), invoice.subtotal, false],
    [t('discount'), invoice.discount, false],
    [t('shipping'), invoice.shipping, false],
    [t('adjustment'), invoice.adjustment, false],
    [t('tax_amount'), invoice.tax_amount, false],
    [t('grand_total'), invoice.total, true],
  ];

  const doc = () => document.getElementById('print-root');
  const paperId = getTemplate(templateId).supportedPaper[0] ?? 'a4';
  const paper = { widthMm: PAPER_SIZES[paperId].widthMm, heightMm: PAPER_SIZES[paperId].heightMm };
  const frozenThermalDefinition = invoice.thermal_template_revision?.definition ?? null;
  const thermalTemplateId = frozenThermalDefinition?.template_id ?? null;
  const thermalPaperId = thermalTemplateId
    ? getTemplate(thermalTemplateId).supportedPaper.find((candidate) => candidate.startsWith('thermal_'))
    : null;
  const thermalPaper = thermalPaperId
    ? { widthMm: PAPER_SIZES[thermalPaperId].widthMm, heightMm: PAPER_SIZES[thermalPaperId].heightMm }
    : null;

  async function handleDownloadPdf() {
    if (!invoice) return;
    setBusy('pdf');
    try {
      const element = doc();
      if (!element) throw new Error('Invoice template is unavailable');
      await documentExporter.download({ element, fileName: invoice.number, paper });
      success(t('downloaded_ok'));
    } catch {
      errorToast(t('export_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function handleShare() {
    if (!invoice) return;
    setBusy('share');
    try {
      const element = doc();
      if (!element) throw new Error('Invoice template is unavailable');
      const result = await documentExporter.share({ element, fileName: invoice.number, title: invoice.number, paper });
      success(result === 'shared' ? t('shared_ok') : t('downloaded_ok'));
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') errorToast(t('export_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function handleExcel() {
    if (!invoice) return;
    setBusy('excel');
    try {
      await exportXlsx(invoice.number, {
        meta: [
          [ti('number'), invoice.number],
          [t('date'), invoice.invoice_date],
          [t('partner'), partnerName],
          [t('paid'), Number(invoice.paid_amount)],
          [t('remaining'), Number(invoice.remaining)],
        ],
        columns: [t('description'), t('qty'), t('unit_price'), t('tax'), ti('total')],
        rows: invoice.lines.map((line) => [
          line.description ?? '—',
          line.quantity,
          Number(line.unit_price),
          Number(line.line_tax),
          Number(line.line_total),
        ]),
        sheetName: 'Invoice',
      });
      success(t('downloaded_ok'));
    } catch {
      errorToast(t('export_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function confirmAction() {
    if (!pendingAction || !invoice) return;
    setActioning(true);
    try {
      if (pendingAction === 'post') {
        await api(`/invoices/${invoice.id}/post`, { method: 'POST' });
        success(t('post_success'));
        setPendingAction(null);
        load();
      } else {
        await api(`/invoices/${invoice.id}`, { method: 'DELETE' });
        success(t('delete_success'));
        router.push('/invoices');
      }
    } catch {
      errorToast(t('action_failed'));
    } finally {
      setActioning(false);
    }
  }

  const documentControls = (
    <>
      <Button variant="outline" size="sm" onClick={handleExcel} disabled={!!busy}>
        <FileSpreadsheet className="h-4 w-4" strokeWidth={1.7} />
        {t('excel')}
      </Button>
      <Button variant="outline" size="sm" onClick={handleDownloadPdf} disabled={!!busy}>
        <Download className="h-4 w-4" strokeWidth={1.7} />
        {busy === 'pdf' ? t('generating') : t('download_pdf')}
      </Button>
      <Button variant="outline" size="sm" onClick={handleShare} disabled={!!busy}>
        <Share2 className="h-4 w-4" strokeWidth={1.7} />
        {busy === 'share' ? t('generating') : t('share')}
      </Button>
      <Button variant="outline" size="sm" onClick={() => printDocument(paper, 'print-root')} disabled={!!busy}>
        <Printer className="h-4 w-4" strokeWidth={1.7} />
        {t('print')}
      </Button>
    </>
  );

  const workControls = (
    <>
      {isDraft && (
        <Link href={`/invoices/${invoice.id}/edit`}>
          <Button variant="outline" size="sm"><Pencil className="h-4 w-4" strokeWidth={1.7} />{t('edit')}</Button>
        </Link>
      )}
      {isDraft && (
        <Button size="sm" onClick={() => setPendingAction('post')} disabled={actioning}>
          <CheckCircle2 className="h-4 w-4" strokeWidth={1.7} />
          {t('post')}
        </Button>
      )}
      {canCollect && (
        <Button size="sm" onClick={() => setPaymentOpen(true)}>
          <Banknote className="h-4 w-4" strokeWidth={1.7} />
          {t('add_payment')}
        </Button>
      )}
    </>
  );

  return (
    <div className="space-y-5">
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <Button variant="ghost" size="icon" className="no-print shrink-0" onClick={() => router.push('/invoices')} aria-label={t('back')}>
              <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
            </Button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="num text-xl font-semibold text-text">{invoice.number}</h1>
                <Badge tone={statusTone[invoice.status] ?? 'muted'}>{ts(invoice.status)}</Badge>
                <Badge tone={payTone[invoice.payment_status] ?? 'muted'}>{ts(invoice.payment_status)}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted">{isDraft ? t('post_confirm') : t('payment_section_note')}</p>
            </div>
          </div>
          <div className="no-print hidden flex-wrap items-center justify-end gap-2 lg:flex">
            {workControls}
            {documentControls}
            <Dropdown
              align="end"
              menuLabel={t('actions')}
              triggerLabel={t('actions')}
              triggerClassName="h-8 border border-border px-2 text-text hover:bg-primary-soft"
              trigger={<MoreVertical className="h-4 w-4" strokeWidth={1.8} />}
            >
              {isPosted && <DropdownItem icon={RotateCcw} onClick={() => setReturnOpen(true)}>{t('create_return')}</DropdownItem>}
              {customer && <DropdownItem icon={ArrowRight} href={`/partners/${invoice.partner_id}`}>{t('open_customer')}</DropdownItem>}
              {frozenThermalDefinition && thermalPaper && thermalTemplateId && (
                <DropdownItem icon={Printer} onClick={() => printDocument(thermalPaper, 'thermal-print-root')}>{tPrint('thermal_print')}</DropdownItem>
              )}
              {isDraft && <DropdownItem icon={Trash2} tone="danger" onClick={() => setPendingAction('delete')}>{t('delete')}</DropdownItem>}
            </Dropdown>
          </div>
        </div>

        <div className="no-print -mx-4 overflow-x-auto px-4 lg:hidden">
          <div className="flex w-max gap-2">
            {workControls}
            <Dropdown
              align="end"
              menuLabel={t('actions')}
              triggerLabel={t('actions')}
              triggerClassName="h-8 border border-border bg-surface px-2 text-text hover:bg-primary-soft"
              trigger={<MoreVertical className="h-4 w-4" strokeWidth={1.8} />}
            >
              {isPosted && <DropdownItem icon={RotateCcw} onClick={() => setReturnOpen(true)}>{t('create_return')}</DropdownItem>}
              {customer && <DropdownItem icon={ArrowRight} href={`/partners/${invoice.partner_id}`}>{t('open_customer')}</DropdownItem>}
              <DropdownItem icon={Printer} onClick={() => printDocument(paper, 'print-root')}>{t('print')}</DropdownItem>
              <DropdownItem icon={Download} onClick={handleDownloadPdf}>{t('download_pdf')}</DropdownItem>
              <DropdownItem icon={FileSpreadsheet} onClick={handleExcel}>{t('excel')}</DropdownItem>
              {isDraft && <DropdownItem icon={Trash2} tone="danger" onClick={() => setPendingAction('delete')}>{t('delete')}</DropdownItem>}
            </Dropdown>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>{t('details')}</CardTitle>
            {customer && <Link href={`/partners/${invoice.partner_id}`} className="text-sm text-primary hover:underline">{t('open_customer')}</Link>}
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
              {info.map(([key, value]) => (
                <div key={key}>
                  <dt className="text-xs text-muted">{key}</dt>
                  <dd className="mt-1 text-text">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-5 border-t border-border pt-4">
              <p className="text-xs text-muted">{t('notes')}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-text">{invoice.notes || t('no_notes')}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('vat_status')}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge tone={zatca?.qr ? 'positive' : 'muted'}>{zatca?.qr ? t('vat_generated') : t('vat_not_generated')}</Badge>
            </div>
            {zatca?.qr ? (
              <div className="flex items-center gap-3">
                <div className="rounded bg-white p-2"><QRCodeSVG value={zatca.qr} size={76} level="M" /></div>
                <dl className="min-w-0 space-y-1 text-xs text-muted">
                  <div className="flex justify-between gap-3"><dt>ICV</dt><dd className="num text-text">{zatca.icv}</dd></div>
                  <div className="truncate" title={zatca.uuid ?? ''}>UUID: <span className="num text-text">{zatca.uuid}</span></div>
                </dl>
              </div>
            ) : <p className="text-sm text-muted">{t('zatca_pending')}</p>}
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card>
          <CardHeader><CardTitle>{t('financial_summary')}</CardTitle></CardHeader>
          <CardContent>
            <dl className="divide-y divide-border">
              {financialSummary.map(([label, value, strong]) => (
                <div key={label} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                  <dt className={strong ? 'font-medium text-text' : 'text-sm text-muted'}>{label}</dt>
                  <dd className={`num ${strong ? 'text-base font-semibold text-text' : 'text-sm text-text'}`}>{formatRiyal(value)}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader><CardTitle>{t('add_payment')}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm leading-6 text-muted">{canCollect ? t('collect_available') : t('fully_paid')}</p>
            <div className="flex items-center justify-between gap-3 rounded border border-border bg-background px-3 py-2.5">
              <span className="text-sm text-muted">{t('remaining')}</span>
              <span className="num text-sm font-semibold text-text">{formatRiyal(invoice.remaining)}</span>
            </div>
            {canCollect && <Button className="w-full" onClick={() => setPaymentOpen(true)}><Banknote className="h-4 w-4" strokeWidth={1.7} />{t('add_payment')}</Button>}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="no-print flex flex-row items-center justify-between gap-3">
          <CardTitle>{t('document')}</CardTitle>
          <Dropdown
            align="end"
            menuLabel={t('template')}
            triggerClassName="h-8 gap-2 border border-border px-3 text-sm text-text hover:bg-primary-soft"
            trigger={
              <>
                <LayoutTemplate className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} />
                <span>{tt(getTemplate(templateId).nameKey)}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" strokeWidth={1.8} />
              </>
            }
          >
            {listTemplates().map((definition) => (
              <DropdownItem key={definition.id} onClick={() => setTemplateId(definition.id)}>{tt(definition.nameKey)}</DropdownItem>
            ))}
          </Dropdown>
        </CardHeader>
        <CardContent className="print:p-0">
          <div className="rounded border border-border bg-background p-3 print:border-0 print:bg-transparent print:p-0">
            <DocumentScaler>
              <InvoiceDocument
                invoice={invoice}
                company={company}
                customer={customer}
                qr={zatca?.qr ?? null}
                templateId={templateId}
                themeId={themeId}
                footerText={footerText}
                terms={termsText}
                bank={bankText}
                stampUrl={stampUrl}
                signatureUrl={signatureUrl}
                showLogo={showLogo}
                logoUrl={logoUrl}
                logoHeight={logoHeight}
                layout={layout}
              />
            </DocumentScaler>
          </div>
        </CardContent>
      </Card>

      {frozenThermalDefinition && thermalPaper && thermalTemplateId && (
        <InvoiceDocument
          invoice={invoice}
          company={company}
          customer={customer}
          qr={zatca?.qr ?? null}
          templateId={thermalTemplateId}
          themeId={frozenThermalDefinition.theme_id ?? null}
          footerText={frozenThermalDefinition.footer_text ?? null}
          showLogo={frozenThermalDefinition.show_logo !== false}
          layout={Array.isArray(frozenThermalDefinition.layout) && frozenThermalDefinition.layout.length ? frozenThermalDefinition.layout : null}
          rootId="thermal-print-root"
        />
      )}

      <section aria-label={t('activity')}><RevisionLog type="invoice" id={id} /></section>

      <PaymentDialog
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        onSaved={load}
        fixedDirection="received"
        initialInvoice={{ id: invoice.id, partnerId: invoice.partner_id, remaining: invoice.remaining }}
      />
      <CreateReturnDialog
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        onCreated={load}
        fixedType="sales"
        initialSalesInvoice={{ id: invoice.id, partnerId: invoice.partner_id }}
      />

      <Dialog
        open={pendingAction !== null}
        onClose={() => (actioning ? null : setPendingAction(null))}
        title={pendingAction === 'post' ? t('post') : t('delete_title')}
      >
        <p className="text-sm leading-6 text-text">
          {pendingAction === 'post' ? t('post_confirm') : <>{t('delete_confirm')} <span className="num font-medium">{invoice.number}</span>؟</>}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" disabled={actioning} onClick={() => setPendingAction(null)}>{t('retry')}</Button>
          <Button variant={pendingAction === 'delete' ? 'danger' : 'primary'} disabled={actioning} onClick={confirmAction}>
            {pendingAction === 'post' ? t('post') : t('delete')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
