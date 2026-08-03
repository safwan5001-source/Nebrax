'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
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
import { documentExporter, printDocument } from '@/modules/documents/services/export';
import { getTemplate, listTemplates, DEFAULT_TEMPLATE_ID } from '@/modules/documents/registry/templates';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import type { ThemeId, DocSectionLayoutItem } from '@/modules/documents/types';
import { PAPER_SIZES } from '@/modules/documents/constants/paper';
import { exportXlsx } from '@/lib/xlsx';

interface Line {
  id: string;
  description: string | null;
  quantity: number;
  unit_price: string;
  tax_rate: number;
  line_subtotal: string;
  line_tax: string;
  line_total: string;
}
interface Invoice {
  id: string;
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

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('invoiceDetail');
  const ti = useTranslations('invoices');
  const ts = useTranslations('status');
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
  const tt = useTranslations('invoiceTemplates');

  const partnerName = customer?.name ?? '—';

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    api<{ data: Invoice }>(`/invoices/${id}`)
      .then(async (r) => {
        setInvoice(r.data);
        const [p, z, m, d] = await Promise.allSettled([
          api<{ data: Customer }>(`/partners/${r.data.partner_id}`),
          api<Zatca>(`/invoices/${id}/zatca`),
          api<{ company: Company }>(`/me`),
          api<{ data: { template?: string; theme?: string; footer_text?: string; show_logo?: boolean; logo?: string; logo_height?: number; sections?: DocSectionLayoutItem[]; terms_text?: string; bank_text?: string; stamp?: string; signature?: string } }>(`/sales-config/designs`),
        ]);
        if (p.status === 'fulfilled') setCustomer(p.value.data);
        if (z.status === 'fulfilled') setZatca(z.value);
        if (m.status === 'fulfilled') setCompany(m.value.company);
        // القالب والهوية الافتراضية من إعدادات التصاميم (تتراجع للافتراضي إن غابت).
        if (d.status === 'fulfilled') {
          const dg = d.value.data ?? {};
          setTemplateId(getTemplate(`tax-invoice-${dg.template ?? ''}`).id);
          if (dg.theme) setThemeId(dg.theme as ThemeId);
          setFooterText(dg.footer_text ?? null);
          setShowLogo(dg.show_logo !== false);
          setLogoUrl(dg.logo ?? null);
          setLogoHeight(dg.logo_height ?? null);
          setLayout(Array.isArray(dg.sections) && dg.sections.length ? dg.sections : null);
          setTermsText(dg.terms_text ?? null);
          setBankText(dg.bank_text ?? null);
          setStampUrl(dg.stamp ?? null);
          setSignatureUrl(dg.signature ?? null);
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

  async function handleDownloadPdf() {
    const el = doc();
    if (!el || !invoice) return;
    setBusy('pdf');
    try {
      await documentExporter.download({ element: el, fileName: invoice.number, paper });
      success(t('downloaded_ok'));
    } catch {
      errorToast(t('export_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function handleShare() {
    const el = doc();
    if (!el || !invoice) return;
    setBusy('share');
    try {
      const r = await documentExporter.share({ element: el, fileName: invoice.number, title: invoice.number, paper });
      success(r === 'shared' ? t('shared_ok') : t('downloaded_ok'));
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') errorToast(t('export_failed')); // إلغاء المستخدم لا يُعدّ خطأ
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
          <Button variant="outline" size="sm" onClick={() => printDocument(paper)} disabled={!!busy}>
            <Printer className="h-4 w-4" strokeWidth={1.7} />
            {t('print')}
          </Button>
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
                <div className="rounded bg-white p-3">
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
    </div>
  );
}
