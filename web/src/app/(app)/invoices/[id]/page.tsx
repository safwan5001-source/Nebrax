'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowRight, Printer, Download, Share2, FileSpreadsheet, LayoutTemplate, ChevronDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dropdown, DropdownItem } from '@/components/ui/dropdown';
import { useToast } from '@/components/ui/toast';
import { InvoiceDocument, type Company, type Customer } from '@/components/invoices/invoice-document';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { printDocument } from '@/modules/documents/services/export';
import { getTemplate, listTemplates, DEFAULT_TEMPLATE_ID } from '@/modules/documents/registry/templates';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import { RevisionLog } from '@/components/documents/revision-log';
import type { ThemeId, DocSectionLayoutItem } from '@/modules/documents/types';
import { PAPER_SIZES } from '@/modules/documents/constants/paper';
import { exportXlsx } from '@/lib/xlsx';
import { createInvoicePdf, downloadInvoicePdf, shareInvoicePdf } from '@/modules/invoices/services/invoice-pdf';
import { resolveFrozenOutputDefinition } from '@/modules/print-templates/services/frozen-output-template';
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
  subtotal: string;
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

/** يحوّل SVG الـ QR المعروض إلى PNG لاستخدامه داخل PDF المتجهي من دون التقاط المستند كاملاً. */
async function qrSvgToPng(svg: SVGSVGElement | null): Promise<string | null> {
  if (!svg) return null;
  const source = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('QR image could not be rendered'));
      image.src = url;
    });
    const size = 480;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size, size);
    context.drawImage(image, 0, 0, size, size);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('invoiceDetail');
  const ti = useTranslations('invoices');
  const td = useTranslations('invoiceDoc');
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
  const [busy, setBusy] = useState<null | 'pdf' | 'share' | 'excel'>(null);
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
  const qrRef = useRef<HTMLDivElement>(null);
  const tt = useTranslations('invoiceTemplates');

  const partnerName = customer?.name ?? '—';

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
          setLogoUrl(null); setLogoHeight(null); setTermsText(frozen.terms_text ?? null); setBankText(frozen.bank_text ?? null); setStampUrl(null); setSignatureUrl(null);
        } else {
          const resolved = live.status === 'fulfilled'
            ? resolveLiveTemplateDefinition(live.value.data, 'tax_invoice')
            : null;
          if (resolved) {
            setTemplateId(resolved.templateId);
            setThemeId(resolved.themeId);
            setFooterText(resolved.footerText);
            setShowLogo(resolved.showLogo);
            setLogoUrl(null); setLogoHeight(resolved.logoHeight);
            setLayout(resolved.layout);
            setTermsText(resolved.termsText); setBankText(resolved.bankText); setStampUrl(resolved.stampUrl); setSignatureUrl(resolved.signatureUrl);
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

  if (!invoice) {
    return <div className="text-muted">{t('not_found')}</div>;
  }

  const info: [string, React.ReactNode][] = [
    [t('partner'), partnerName],
    [t('date'), <span key="d" className="num">{invoice.invoice_date}</span>],
    [t('payment_type'), invoice.payment_type === 'cash' ? t('cash') : t('credit')],
    [ti('total'), <span key="t" className="num font-semibold">{formatRiyal(invoice.total)}</span>],
    [t('paid'), <span key="p" className="num">{formatRiyal(invoice.paid_amount)}</span>],
    [t('remaining'), <span key="r" className="num">{formatRiyal(invoice.remaining)}</span>],
  ];

  const doc = () => document.getElementById('print-root');
  // حجم ورق القالب المختار (A4 افتراضياً، أو الحراري) — يوجّه الـ PDF والطباعة.
  const paperId = getTemplate(templateId).supportedPaper[0] ?? 'a4';
  const paper = { widthMm: PAPER_SIZES[paperId].widthMm, heightMm: PAPER_SIZES[paperId].heightMm };
  const frozenPdfDefinition = resolveFrozenOutputDefinition(
    invoice.pdf_template_revision,
    invoice.print_template_revision,
  );
  const frozenThermalDefinition = invoice.thermal_template_revision?.definition ?? null;
  const thermalTemplateId = frozenThermalDefinition?.template_id ?? null;
  const thermalPaperId = thermalTemplateId
    ? getTemplate(thermalTemplateId).supportedPaper.find((candidate) => candidate.startsWith('thermal_'))
    : null;
  const thermalPaper = thermalPaperId
    ? { widthMm: PAPER_SIZES[thermalPaperId].widthMm, heightMm: PAPER_SIZES[thermalPaperId].heightMm }
    : null;

  const buildVectorInvoicePdf = async () => {
    if (!invoice) throw new Error('Invoice is not loaded');
    const qrImage = await qrSvgToPng(qrRef.current?.querySelector('svg') ?? null);
    return createInvoicePdf({
      invoice,
      company,
      customer,
      qrImage,
      logoUrl,
      // المخرج المؤرشف حدّ تاريخي كامل: لا نملأ فراغه بإعداد حي أحدث.
      footerText: frozenPdfDefinition ? frozenPdfDefinition.footer_text ?? null : footerText,
      templateLayout: frozenPdfDefinition
        ? (Array.isArray(frozenPdfDefinition.layout) && frozenPdfDefinition.layout.length ? frozenPdfDefinition.layout : null)
        : layout,
      termsText: frozenPdfDefinition ? frozenPdfDefinition.terms_text ?? null : termsText,
      bankText: frozenPdfDefinition ? frozenPdfDefinition.bank_text ?? null : bankText,
      locale,
      labels: {
        title: td('title'), titleSecondary: td('title_en'), seller: td('seller'), billTo: td('bill_to'),
        invoiceNumber: td('number'), vatNumber: td('vat_number'), crNumber: td('cr_number'), city: td('city'),
        date: td('date'), paymentType: td('payment_type'), cash: td('cash'), credit: td('credit'),
        description: td('product'), productCode: td('product_code'), barcode: td('barcode'),
        quantity: td('qty'), priceBeforeTax: td('price_before_tax'), unitPrice: td('unit_price'), tax: td('tax'), total: td('total'),
        subtotal: td('subtotal'), vat: td('vat'), grandTotal: td('grand_total'), qrNote: td('zatca_note'),
        terms: td('terms'), bank: td('bank'), footer: td('footer'),
      },
    });
  };

  async function handleDownloadPdf() {
    if (!invoice) return;
    setBusy('pdf');
    try {
      const blob = await buildVectorInvoicePdf();
      downloadInvoicePdf(blob, invoice.number);
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
      const blob = await buildVectorInvoicePdf();
      const result = await shareInvoicePdf(blob, invoice.number, invoice.number);
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
        rows: invoice.lines.map((l) => [
          l.description ?? '—',
          l.quantity,
          Number(l.unit_price),
          Number(l.line_tax),
          Number(l.line_total),
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" className="no-print" onClick={() => router.push('/invoices')} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="num text-xl font-semibold text-text">{invoice.number}</h1>
        <Badge tone={statusTone[invoice.status] ?? 'muted'}>{ts(invoice.status)}</Badge>
        <Badge tone={payTone[invoice.payment_status] ?? 'muted'}>{ts(invoice.payment_status)}</Badge>
        <div className="no-print ms-auto flex flex-wrap items-center gap-2">
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
          {frozenThermalDefinition && thermalPaper && thermalTemplateId && (
            <Button variant="outline" size="sm" onClick={() => printDocument(thermalPaper, 'thermal-print-root')} disabled={!!busy}>
              <Printer className="h-4 w-4" strokeWidth={1.7} />
              {tPrint('thermal_print')}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('details')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              {info.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="text-text">{v}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('zatca')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3">
            {zatca?.qr ? (
              <>
                <div ref={qrRef} className="rounded bg-white p-3">
                  <QRCodeSVG value={zatca.qr} size={140} level="M" />
                </div>
                <div className="w-full space-y-1 text-xs text-muted">
                  <div className="flex justify-between gap-2">
                    <span>ICV</span>
                    <span className="num text-text">{zatca.icv}</span>
                  </div>
                  <div className="truncate" title={zatca.uuid ?? ''}>
                    UUID: <span className="num text-text">{zatca.uuid}</span>
                  </div>
                </div>
              </>
            ) : (
              <p className="py-6 text-xs text-muted">{t('zatca_pending')}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* معاينة قالب الفاتورة الضريبية A4 (مرئية على الشاشة + مصدر الطباعة/الـ PDF) */}
      <Card>
        <CardHeader className="no-print flex flex-row items-center justify-between gap-3">
          <CardTitle>{t('preview')}</CardTitle>
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
            {listTemplates().map((d) => (
              <DropdownItem key={d.id} onClick={() => setTemplateId(d.id)}>
                {tt(d.nameKey)}
              </DropdownItem>
            ))}
          </Dropdown>
        </CardHeader>
        <CardContent className="print:p-0">
          <div className="rounded-lg bg-gray-100 p-3 dark:bg-black/30 print:bg-transparent print:p-0">
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

      {/* سجلّ التغييرات — لا يُطبع مع المستند. */}
      <RevisionLog type="invoice" id={id} />
    </div>
  );
}
