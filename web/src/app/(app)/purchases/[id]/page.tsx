'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Printer, Eye, EyeOff, Pencil, Trash2, Download, Share2, FileSpreadsheet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import type { Party, DocLine } from '@/components/documents/tax-document';
import { PurchaseDocument } from '@/components/purchases/purchase-document';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { useCompany } from '@/lib/company';
import { exportXlsx } from '@/lib/xlsx';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import { documentExporter, printDocument } from '@/modules/documents/services/export';
import { getTemplate, DEFAULT_TEMPLATE_ID } from '@/modules/documents/registry/templates';
import { PAPER_SIZES } from '@/modules/documents/constants/paper';
import type { ThemeId, DocSectionLayoutItem } from '@/modules/documents/types';
import { resolveLiveTemplateDefinition, type LivePrintTemplateAssignment } from '@/modules/print-templates/services/live-template-definition';

interface FrozenPrintTemplateRevision {
  id: string;
  version: number;
  definition: {
    template_id?: string;
    theme_id?: ThemeId;
    footer_text?: string;
    show_logo?: boolean;
    logo?: string;
    logo_height?: number;
    layout?: DocSectionLayoutItem[];
    terms_text?: string;
    bank_text?: string;
    stamp?: string;
    signature?: string;
  };
  document_types: string[];
}

interface Purchase {
  id: string;
  branch_id?: string | null;
  number: string;
  partner_id: string;
  payment_type: string;
  status: string;
  payment_status: string;
  purchase_date: string;
  supplier_invoice_no: string | null;
  subtotal: string;
  tax_amount: string;
  total: string;
  discount: string;
  shipping: string;
  adjustment: string;
  paid_amount: string;
  remaining: string;
  due_date: string | null;
  received_status: string;
  received_date: string | null;
  lines: DocLine[];
  print_template_revision_id?: string | null;
  print_template_revision?: FrozenPrintTemplateRevision | null;
  pdf_template_revision_id?: string | null;
  pdf_template_revision?: FrozenPrintTemplateRevision | null;
  thermal_template_revision_id?: string | null;
  thermal_template_revision?: FrozenPrintTemplateRevision | null;
}

const statusTone: Record<string, 'positive' | 'muted' | 'negative'> = { posted: 'positive', draft: 'muted', cancelled: 'negative' };
const payTone: Record<string, 'positive' | 'warning' | 'muted'> = { paid: 'positive', partial: 'warning', unpaid: 'muted' };

function receiptKey(status: string | null | undefined): 'pending' | 'partial' | 'full' {
  if (status === 'partial') return 'partial';
  if (status === 'received' || status === 'full') return 'full';
  return 'pending';
}

export default function PurchaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('invoiceDetail');
  const tp = useTranslations('purchases');
  const tpf = useTranslations('purchaseForm');
  const tpp = useTranslations('purchasePdf');
  const ts = useTranslations('status');
  const tPrint = useTranslations('documentPrint');
  const company = useCompany();

  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [supplier, setSupplier] = useState<Party | null>(null);
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE_ID);
  const [themeId, setThemeId] = useState<ThemeId | null>(null);
  const [footerText, setFooterText] = useState<string | null>(null);
  const [showLogo, setShowLogo] = useState(true);
  const [logoHeight, setLogoHeight] = useState<number | null>(null);
  const [layout, setLayout] = useState<DocSectionLayoutItem[] | null>(null);
  const [termsText, setTermsText] = useState<string | null>(null);
  const [bankText, setBankText] = useState<string | null>(null);
  const [stampUrl, setStampUrl] = useState<string | null>(null);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // المعاينة تُظهر مستند A4 على الشاشة — هو نفسه المطبوع، فلا معاينةٌ تُخالف
  // ما يخرج من الطابعة.
  const [preview, setPreview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState<null | 'pdf' | 'share' | 'excel'>(null);
  const { success, error: errorToast } = useToast();

  async function remove() {
    setDeleting(true);
    try {
      await api(`/purchases/${id}`, { method: 'DELETE' });
      success(tp('deleted'));
      router.push('/purchases');
    } catch (e) {
      errorToast(e instanceof ApiError ? e.message : tp('posted_locked'));
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    api<{ data: Purchase }>(`/purchases/${id}`)
      .then(async (r) => {
        setPurchase(r.data);
        const branchQuery = r.data.branch_id ? `&branch_id=${encodeURIComponent(r.data.branch_id)}` : '';
        const [partner, live] = await Promise.allSettled([
          api<{ data: Party }>(`/partners/${r.data.partner_id}`),
          api<{ data: LivePrintTemplateAssignment | null }>(`/print-templates/resolve?document_type=purchase_invoice&usage=print${branchQuery}`),
        ]);
        if (partner.status === 'fulfilled') setSupplier(partner.value.data);

        const frozen = r.data.print_template_revision?.definition;
        if (frozen) {
          setTemplateId(frozen.template_id ?? DEFAULT_TEMPLATE_ID);
          setThemeId(frozen.theme_id ?? null);
          setFooterText(frozen.footer_text ?? null);
          setShowLogo(frozen.show_logo !== false);
          setLogoHeight(frozen.logo_height ?? null);
          setLayout(Array.isArray(frozen.layout) && frozen.layout.length ? frozen.layout : null);
          setTermsText(frozen.terms_text ?? null);
          setBankText(frozen.bank_text ?? null);
          setStampUrl(frozen.stamp ?? null);
          setSignatureUrl(frozen.signature ?? null);
          return;
        }

        const resolved = live.status === 'fulfilled'
          ? resolveLiveTemplateDefinition(live.value.data, 'purchase_invoice')
          : null;
        if (!resolved) return;
        setTemplateId(resolved.templateId);
        setThemeId(resolved.themeId);
        setFooterText(resolved.footerText);
        setShowLogo(resolved.showLogo);
        setLogoHeight(resolved.logoHeight);
        setLayout(resolved.layout);
        setTermsText(resolved.termsText);
        setBankText(resolved.bankText);
        setStampUrl(resolved.stampUrl);
        setSignatureUrl(resolved.signatureUrl);
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!purchase) return <div className="text-muted">{t('not_found')}</div>;

  const isDraft = purchase.status === 'draft';
  const receivedStatusKey = receiptKey(purchase.received_status);
  const receivedStatusLabel = tpp(`received_${receivedStatusKey}`);
  const paperId = getTemplate(templateId).supportedPaper[0] ?? 'a4';
  const paper = { widthMm: PAPER_SIZES[paperId].widthMm, heightMm: PAPER_SIZES[paperId].heightMm };
  const frozenThermalDefinition = purchase.thermal_template_revision?.definition ?? null;
  const thermalTemplateId = frozenThermalDefinition?.template_id ?? null;
  const thermalPaperId = thermalTemplateId
    ? getTemplate(thermalTemplateId).supportedPaper.find((candidate) => candidate.startsWith('thermal_'))
    : null;
  const thermalPaper = thermalPaperId
    ? { widthMm: PAPER_SIZES[thermalPaperId].widthMm, heightMm: PAPER_SIZES[thermalPaperId].heightMm }
    : null;

  const handleDownloadPdf = async () => {
    setBusy('pdf');
    try {
      const element = document.getElementById('print-root');
      if (!element) throw new Error('Purchase template is unavailable');
      await documentExporter.download({ element, fileName: purchase.number, paper });
      success(t('downloaded_ok'));
    } catch {
      errorToast(t('export_failed'));
    } finally {
      setBusy(null);
    }
  };

  const handleSharePdf = async () => {
    setBusy('share');
    try {
      const element = document.getElementById('print-root');
      if (!element) throw new Error('Purchase template is unavailable');
      const result = await documentExporter.share({ element, fileName: purchase.number, title: purchase.number, paper });
      success(result === 'shared' ? t('shared_ok') : t('downloaded_ok'));
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') errorToast(t('export_failed'));
    } finally {
      setBusy(null);
    }
  };

  const handleExcel = async () => {
    setBusy('excel');
    try {
      await exportXlsx(purchase.number, {
        meta: [[tp('number'), purchase.number], [tp('supplier'), supplier?.name ?? '—'], [t('date'), purchase.purchase_date], [tp('total'), Number(purchase.total)]],
        columns: [t('description'), t('qty'), t('unit_price'), t('tax'), tp('total')],
        rows: purchase.lines.map((line) => [line.description ?? '—', line.quantity, Number(line.unit_price), Number(line.line_tax), Number(line.line_total)]),
        sheetName: 'Purchase invoice',
      });
      success(t('downloaded_ok'));
    } catch {
      errorToast(t('export_failed'));
    } finally {
      setBusy(null);
    }
  };

  const info: [string, React.ReactNode][] = [
    [tp('supplier'), supplier?.name ?? '—'],
    [t('date'), <span key="d" className="num">{purchase.purchase_date}</span>],
    [t('payment_type'), purchase.payment_type === 'cash' ? t('cash') : t('credit')],
    [tp('total'), <span key="t" className="num font-semibold">{formatRiyal(purchase.total)}</span>],
    [t('paid'), <span key="p" className="num">{formatRiyal(purchase.paid_amount)}</span>],
    [t('remaining'), <span key="r" className="num">{formatRiyal(purchase.remaining)}</span>],
    // الاستلام إعلامي: تاريخُ وصول البضاعة قد يخالف تاريخ الفاتورة.
    [tpf('received_status'), receivedStatusLabel],
    [tpf('received_date'), <span key="rd" className="num">{purchase.received_date ?? '—'}</span>],
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="no-print" onClick={() => router.push('/purchases')} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="num text-xl font-semibold text-text">{purchase.number}</h1>
        <Badge tone={statusTone[purchase.status] ?? 'muted'}>{ts(purchase.status)}</Badge>
        <Badge tone={payTone[purchase.payment_status] ?? 'muted'}>{ts(purchase.payment_status)}</Badge>
        {/* المرحّلة لا تُعدَّل ولا تُحذف: لها قيدٌ في الدفتر وحركةُ مخزون
            غيّرت المتوسط المتحرك. الزرّان معطّلان بسبب مكتوب لا مخفيّان. */}
        <div className="no-print ms-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPreview((v) => !v)} disabled={!!busy}>
            {preview ? <EyeOff className="h-4 w-4" strokeWidth={1.7} /> : <Eye className="h-4 w-4" strokeWidth={1.7} />}
            {preview ? tp('hide_preview') : tp('view')}
          </Button>
          <Button variant="outline" size="sm" onClick={handleExcel} disabled={!!busy}>
            <FileSpreadsheet className="h-4 w-4" strokeWidth={1.7} />
            {t('excel')}
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownloadPdf} disabled={!!busy}>
            <Download className="h-4 w-4" strokeWidth={1.7} />
            {busy === 'pdf' ? t('generating') : t('download_pdf')}
          </Button>
          <Button variant="outline" size="sm" onClick={handleSharePdf} disabled={!!busy}>
            <Share2 className="h-4 w-4" strokeWidth={1.7} />
            {busy === 'share' ? t('generating') : t('share')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!isDraft}
            title={isDraft ? tp('edit') : tp('posted_locked')}
            onClick={() => router.push(`/purchases/${purchase.id}/edit`)}
          >
            <Pencil className="h-4 w-4" strokeWidth={1.7} />
            {tp('edit')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!isDraft}
            title={isDraft ? tp('delete') : tp('posted_locked')}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className={`h-4 w-4 ${isDraft ? 'text-negative' : ''}`} strokeWidth={1.7} />
            {tp('delete')}
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

      {!isDraft && (
        <p className="no-print rounded border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-muted">
          {tp('posted_locked')}
        </p>
      )}

      <Card>
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
          <CardTitle>{t('lines')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>{t('description')}</TH>
                <TH className="text-end">{t('qty')}</TH>
                <TH className="text-end">{t('unit_price')}</TH>
                <TH className="text-end">{t('tax')}</TH>
                <TH className="text-end">{tp('total')}</TH>
              </TR>
            </THead>
            <TBody>
              {purchase.lines.map((l) => (
                <TR key={l.id}>
                  <TD>{l.description ?? '—'}</TD>
                  <TD className="num text-end">{l.quantity}</TD>
                  <TD className="num text-end">{formatRiyal(l.unit_price)}</TD>
                  <TD className="num text-end">{formatRiyal(l.line_tax)}</TD>
                  <TD className="num text-end">{formatRiyal(l.line_total)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      {/* القالب نفسه للشاشة والطباعة وPDF؛ يبقى في DOM عند إخفاء المعاينة لتلتقطه عملية التصدير. */}
      <div className={preview ? 'rounded border border-border bg-surface p-2' : 'hidden print:block'}>
        <DocumentScaler>
          <PurchaseDocument
            purchase={purchase}
            company={company}
            supplier={supplier}
            templateId={templateId}
            themeId={themeId}
            footerText={footerText}
            terms={termsText}
            bank={bankText}
            stampUrl={stampUrl}
            signatureUrl={signatureUrl}
            showLogo={showLogo}
            logoHeight={logoHeight}
            layout={layout}
          />
        </DocumentScaler>
      </div>

      {frozenThermalDefinition && thermalPaper && thermalTemplateId && (
        <PurchaseDocument
          purchase={purchase}
          company={company}
          supplier={supplier}
          templateId={thermalTemplateId}
          themeId={frozenThermalDefinition.theme_id ?? null}
          footerText={frozenThermalDefinition.footer_text ?? null}
          terms={frozenThermalDefinition.terms_text ?? null}
          bank={frozenThermalDefinition.bank_text ?? null}
          stampUrl={frozenThermalDefinition.stamp ?? null}
          signatureUrl={frozenThermalDefinition.signature ?? null}
          showLogo={frozenThermalDefinition.show_logo !== false}
          logoUrl={frozenThermalDefinition.logo ?? null}
          logoHeight={frozenThermalDefinition.logo_height ?? null}
          layout={Array.isArray(frozenThermalDefinition.layout) && frozenThermalDefinition.layout.length ? frozenThermalDefinition.layout : null}
          rootId="thermal-print-root"
        />
      )}

      <Dialog open={confirmDelete} onClose={() => (deleting ? null : setConfirmDelete(false))} title={tp('delete_title')}>
        <p className="text-sm text-text">
          {tp('delete_confirm')} <span className="num font-medium">{purchase.number}</span>؟
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleting}>{tp('cancel')}</Button>
          <Button variant="danger" onClick={remove} disabled={deleting}>{tp('delete')}</Button>
        </div>
      </Dialog>
    </div>
  );
}
