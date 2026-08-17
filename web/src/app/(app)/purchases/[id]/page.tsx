'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, Printer, Eye, EyeOff, Pencil, Trash2, Download, Share2, FileSpreadsheet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { TaxDocument, type Party, type DocLine, type DocAdjustment } from '@/components/documents/tax-document';
import { PurchaseDocument } from '@/components/purchases/purchase-document';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { useCompany } from '@/lib/company';
import { exportXlsx } from '@/lib/xlsx';
import { createPurchaseInvoicePdf, downloadPurchaseInvoicePdf, sharePurchaseInvoicePdf } from '@/modules/purchases/services/purchase-pdf';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import { printDocument } from '@/modules/documents/services/export';
import { resolveFrozenOutputDefinition } from '@/modules/print-templates/services/frozen-output-template';
import { getTemplate } from '@/modules/documents/registry/templates';
import { PAPER_SIZES } from '@/modules/documents/constants/paper';
import type { ThemeId, DocSectionLayoutItem } from '@/modules/documents/types';

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
  const td = useTranslations('invoiceDoc');
  const ts = useTranslations('status');
  const tPrint = useTranslations('documentPrint');
  const locale = useLocale();
  const company = useCompany();

  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [supplier, setSupplier] = useState<Party | null>(null);
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
        const p = await api<{ data: Party }>(`/partners/${r.data.partner_id}`).catch(() => null);
        if (p) setSupplier(p.data);
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
  const frozenPrintFooter = purchase.print_template_revision?.definition.footer_text ?? null;
  const frozenPdfDefinition = resolveFrozenOutputDefinition(
    purchase.pdf_template_revision,
    purchase.print_template_revision,
  );
  const frozenPdfFooter = frozenPdfDefinition?.footer_text ?? null;
  const frozenThermalDefinition = purchase.thermal_template_revision?.definition ?? null;
  const thermalTemplateId = frozenThermalDefinition?.template_id ?? null;
  const thermalPaperId = thermalTemplateId
    ? getTemplate(thermalTemplateId).supportedPaper.find((candidate) => candidate.startsWith('thermal_'))
    : null;
  const thermalPaper = thermalPaperId
    ? { widthMm: PAPER_SIZES[thermalPaperId].widthMm, heightMm: PAPER_SIZES[thermalPaperId].heightMm }
    : null;

  /**
   * الخصم والشحن والتسوية كانت تُحذَف من المستند المطبوع، فيقرأ المورّد
   * «المجموع + الضريبة ≠ الإجمالي» ويبدو المستندُ خاطئ الحساب. والقيمة تُرسَل
   * **موجبة دائماً** و`negative` للعرض وحده — وإلا ضُوعفت إشارةُ السالب.
   */
  const adjustmentValue = Number(purchase.adjustment ?? 0);
  const adjustments: DocAdjustment[] = [
    ...(Number(purchase.discount) > 0
      ? [{ label: tpf('discount'), amount: purchase.discount, negative: true }] : []),
    ...(Number(purchase.shipping) > 0
      ? [{ label: tpf('shipping'), amount: purchase.shipping }] : []),
    ...(Number.isFinite(adjustmentValue) && adjustmentValue !== 0
      ? [{
          label: tpf('adjustment'),
          amount: String(Math.abs(adjustmentValue)),
          negative: adjustmentValue < 0,
        }] : []),
  ];

  const buildPurchasePdf = async () => createPurchaseInvoicePdf({
    purchase,
    company,
    supplier,
    adjustments,
    stampUrl: frozenPdfDefinition?.stamp ?? null,
    signatureUrl: frozenPdfDefinition?.signature ?? null,
    footerText: frozenPdfFooter,
    templateLayout: Array.isArray(frozenPdfDefinition?.layout) && frozenPdfDefinition.layout.length ? frozenPdfDefinition.layout : null,
    termsText: frozenPdfDefinition?.terms_text ?? null,
    bankText: frozenPdfDefinition?.bank_text ?? null,
    locale,
    labels: {
      title: tpp('title'), titleSecondary: tpp('title_secondary'), seller: tpp('buyer'), billTo: tpp('supplier'),
      invoiceNumber: tp('number'), vatNumber: td('vat_number'), crNumber: td('cr_number'), city: td('city'),
      date: td('date'), paymentType: td('payment_type'), cash: td('cash'), credit: td('credit'),
      description: td('description'), quantity: td('qty'), unitPrice: td('unit_price'), tax: td('tax'), total: tp('total'),
      subtotal: tpf('subtotal'), vat: tpf('tax_amount'), grandTotal: tp('total'), qrNote: '',
      terms: td('terms'), bank: td('bank'), footer: tpp('footer'),
      supplierInvoiceNumber: tpp('supplier_invoice_number'), dueDate: tpp('due_date'), receiptStatus: tpp('receipt_status'),
      receivedPending: tpp('received_pending'), receivedPartial: tpp('received_partial'), receivedFull: tpp('received_full'),
    },
  });

  const handleDownloadPdf = async () => {
    setBusy('pdf');
    try {
      downloadPurchaseInvoicePdf(await buildPurchasePdf(), purchase.number);
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
      const result = await sharePurchaseInvoicePdf(await buildPurchasePdf(), purchase.number, purchase.number);
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
          <Button variant="outline" size="sm" onClick={() => printDocument({ widthMm: 210, heightMm: 297 }, 'print-root')} disabled={!!busy}>
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

      {/* مستند فاتورة المشتريات A4 — للطباعة دائماً، وعلى الشاشة عند المعاينة */}
      <div className={preview ? 'rounded border border-border bg-surface p-2 [&_.print-only]:block' : undefined}>
        <DocumentScaler>
          <TaxDocument
            title={tp('doc_title')}
            company={company}
            partyLabel={tp('supplier')}
            party={supplier}
            metaRows={[
              [tp('number'), purchase.number],
              [t('date'), purchase.purchase_date],
              [t('payment_type'), purchase.payment_type === 'cash' ? t('cash') : t('credit')],
              ...(purchase.due_date ? [[tpf('due_date'), purchase.due_date] as [string, string]] : []),
              [tpf('received_status'), receivedStatusLabel],
              ...(purchase.received_date ? [[tpf('received_date'), purchase.received_date] as [string, string]] : []),
            ]}
            lines={purchase.lines}
            subtotal={purchase.subtotal}
            adjustments={adjustments}
            tax={purchase.tax_amount}
            total={purchase.total}
            footerText={frozenPrintFooter}
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
