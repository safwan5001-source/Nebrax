'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { ArrowLeftRight, ArrowRight, CopyPlus, Download, Eye, EyeOff, FileOutput, Printer, Share2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { RevisionLog } from '@/components/documents/revision-log';
import {
  PurchaseOrderDocument,
  type PurchaseOrderCompany,
  type PurchaseOrderSupplier,
} from '@/components/procurement/purchase-order-document';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { documentExporter, printDocument } from '@/modules/documents/services/export';
import { getTemplate, DEFAULT_TEMPLATE_ID } from '@/modules/documents/registry/templates';
import { PAPER_SIZES } from '@/modules/documents/constants/paper';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import type { DocSectionLayoutItem, ThemeId } from '@/modules/documents/types';
import type { LivePrintTemplateAssignment, LiveTemplateRevision, ResolvedLiveTemplate } from '@/modules/print-templates/services/live-template-definition';
import { resolveDocumentOutputTemplates } from '@/modules/print-templates/services/document-output-template';
import {
  NEXT_STATUSES,
  NEXT_TARGETS,
  PROCUREMENT_ROUTE,
  canConvert,
  statusTone,
  type ProcurementStatus,
  type ProcurementType,
} from '@/lib/procurement';

interface Line {
  id: string; description: string | null; quantity: number;
  unit_price: string; tax_rate: number; line_tax: string; line_total: string;
}

interface FrozenPrintTemplateRevision {
  id: string;
  definition?: LiveTemplateRevision['definition'];
}

interface Doc {
  id: string; type: ProcurementType; number: string; partner_id: string | null; partner_name?: string | null;
  branch_id?: string | null;
  status: ProcurementStatus; doc_date: string; due_date: string | null; requested_by: string | null;
  subtotal: string; tax_amount: string; total: string; notes: string | null;
  source_document_id: string | null; source_number?: string | null; source_type?: ProcurementType | null;
  converted_purchase_id: string | null;
  print_issued_at: string | null; revised_from_id: string | null; revised_from_number?: string | null;
  print_template_revision?: FrozenPrintTemplateRevision | null;
  pdf_template_revision?: FrozenPrintTemplateRevision | null;
  thermal_template_revision?: FrozenPrintTemplateRevision | null;
  supplier_ids?: string[]; lines: Line[];
}

function liveAssignment(result: PromiseSettledResult<unknown>): LivePrintTemplateAssignment | null {
  if (result.status !== 'fulfilled' || !result.value || typeof result.value !== 'object') return null;
  const data = (result.value as { data?: LivePrintTemplateAssignment | null }).data;
  return data ?? null;
}

function documentPropsFromResolved(resolved: ResolvedLiveTemplate) {
  return {
    templateId: resolved.templateId,
    themeId: resolved.themeId,
    footerText: resolved.footerText,
    terms: resolved.termsText,
    bank: resolved.bankText,
    stampUrl: resolved.stampUrl,
    signatureUrl: resolved.signatureUrl,
    showLogo: resolved.showLogo,
    logoHeight: resolved.logoHeight,
    layout: resolved.layout,
  };
}

/**
 * تفاصيل مستند شراء + شريط إجراءاته.
 *
 * الأزرار المعروضة مشتقّة من `NEXT_STATUSES`/`NEXT_TARGETS` — مرآة قواعد
 * الخادم — فلا يُعرَض إجراء يرفضه. الخادم يبقى الحارس؛ هذه واجهة تُجنّب
 * المستخدم اكتشاف المنع بـ 422.
 */
export function ProcurementDetail({ type }: { type: ProcurementType }) {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('procurement');
  const tc = useTranslations('common');
  const tPrint = useTranslations('documentPrint');
  const { success, error: errorToast } = useToast();

  const [doc, setDoc] = useState<Doc | null>(null);
  const [supplier, setSupplier] = useState<PurchaseOrderSupplier | null>(null);
  const [company, setCompany] = useState<PurchaseOrderCompany | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [outputBusy, setOutputBusy] = useState<null | 'pdf' | 'share'>(null);
  const [preview, setPreview] = useState(false);
  const [templateId, setTemplateId] = useState<string>(DEFAULT_TEMPLATE_ID);
  const [themeId, setThemeId] = useState<ThemeId | null>(null);
  const [footerText, setFooterText] = useState<string | null>(null);
  const [showLogo, setShowLogo] = useState(true);
  const [logoHeight, setLogoHeight] = useState<number | null>(null);
  const [layout, setLayout] = useState<DocSectionLayoutItem[] | null>(null);
  const [termsText, setTermsText] = useState<string | null>(null);
  const [bankText, setBankText] = useState<string | null>(null);
  const [stampUrl, setStampUrl] = useState<string | null>(null);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [pdfOutput, setPdfOutput] = useState<ResolvedLiveTemplate | null>(null);
  const [pdfSharesPrintRoot, setPdfSharesPrintRoot] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setSupplier(null);
    setCompany(null);
    api<{ data: Doc }>(`/procurement/${id}`)
      .then(async (response) => {
        setDoc(response.data);
        if (response.data.type !== 'order') return;

        const issued = Boolean(response.data.print_issued_at);
        const branchQuery = response.data.branch_id ? `&branch_id=${encodeURIComponent(response.data.branch_id)}` : '';
        const skipped = Promise.resolve({ data: null as LivePrintTemplateAssignment | null });
        const resolveUsage = (usage: 'print' | 'pdf') => (
          api<{ data: LivePrintTemplateAssignment | null }>(
            `/print-templates/resolve?document_type=purchase_order&usage=${usage}${branchQuery}`,
          )
        );
        const [partner, me, livePrint, livePdf] = await Promise.allSettled([
          response.data.partner_id
            ? api<{ data: PurchaseOrderSupplier }>(`/partners/${response.data.partner_id}`)
            : skipped,
          api<{ company: PurchaseOrderCompany }>('/me'),
          issued ? skipped : resolveUsage('print'),
          issued ? skipped : resolveUsage('pdf'),
        ]);
        if (partner.status === 'fulfilled' && response.data.partner_id) {
          setSupplier((partner.value as { data: PurchaseOrderSupplier }).data);
        }
        if (me.status === 'fulfilled') setCompany(me.value.company);

        const outputs = resolveDocumentOutputTemplates({
          documentType: 'purchase_order',
          isPosted: issued,
          frozenPrint: response.data.print_template_revision,
          frozenPdf: response.data.pdf_template_revision,
          livePrint: liveAssignment(livePrint),
          livePdf: liveAssignment(livePdf),
        });
        const resolved = outputs.print;
        if (resolved) {
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
        } else {
          setTemplateId(DEFAULT_TEMPLATE_ID);
          setThemeId(null);
          setFooterText(null);
          setShowLogo(true);
          setLogoHeight(null);
          setLayout(null);
          setTermsText(null);
          setBankText(null);
          setStampUrl(null);
          setSignatureUrl(null);
        }
        setPdfOutput(outputs.pdf);
        setPdfSharesPrintRoot(outputs.pdfSharesPrintRoot);
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => load(), [load]);

  async function move(status: ProcurementStatus) {
    setBusy(true);
    try {
      await api(`/procurement/${id}/transition`, { method: 'POST', body: { status } });
      success(tc('updated'));
      load();
    } catch (e) {
      errorToast(e instanceof ApiError ? e.message : tc('saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function issue() {
    setBusy(true);
    try {
      await api(`/procurement/${id}/issue`, { method: 'POST' });
      success(tc('updated'));
      load();
    } catch (e) {
      errorToast(e instanceof ApiError ? e.message : tc('saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function revise() {
    setBusy(true);
    try {
      const revision = await api<{ data: { id: string } }>(`/procurement/${id}/revise`, { method: 'POST' });
      success(tc('created'));
      router.push(`${PROCUREMENT_ROUTE[type]}/${revision.data.id}`);
    } catch (e) {
      errorToast(e instanceof ApiError ? e.message : tc('saveFailed'));
      setBusy(false);
    }
  }

  async function convert(target: string) {
    setBusy(true);
    try {
      const created = await api<{ data: { id: string } }>(`/procurement/${id}/convert`, {
        method: 'POST',
        body: { target, partner_id: doc?.partner_id ?? undefined },
      });
      success(tc('created'));
      router.push(target === 'purchase'
        ? `/purchases/${created.data.id}`
        : `${PROCUREMENT_ROUTE[target as ProcurementType]}/${created.data.id}`);
    } catch (e) {
      errorToast(e instanceof ApiError ? e.message : tc('saveFailed'));
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /></div>;
  }
  if (!doc) return <div className="text-muted">{t('not_found')}</div>;

  const route = PROCUREMENT_ROUTE[type];
  const info: [string, React.ReactNode][] = [
    ...(doc.partner_name ? [[t('supplier'), doc.partner_name] as [string, React.ReactNode]] : []),
    ...(doc.requested_by ? [[t('requested_by'), doc.requested_by] as [string, React.ReactNode]] : []),
    [t('date'), <span key="d" className="num">{doc.doc_date}</span>],
    ...(doc.due_date ? [[t(`${type}.due_label`), <span key="u" className="num">{doc.due_date}</span>] as [string, React.ReactNode]] : []),
    [t('total'), <span key="t" className="num font-semibold">{formatRiyal(doc.total)}</span>],
  ];
  const isPurchaseOrder = type === 'order';
  const paperId = getTemplate(templateId).supportedPaper[0] ?? 'a4';
  const paper = { widthMm: PAPER_SIZES[paperId].widthMm, heightMm: PAPER_SIZES[paperId].heightMm };
  const pdfPaperId = (pdfOutput ? getTemplate(pdfOutput.templateId).supportedPaper[0] : paperId) ?? 'a4';
  const pdfPaper = { widthMm: PAPER_SIZES[pdfPaperId].widthMm, heightMm: PAPER_SIZES[pdfPaperId].heightMm };
  const printRootId = 'purchase-order-print-root';
  const pdfDoc = () => document.getElementById(pdfSharesPrintRoot ? printRootId : 'pdf-print-root');

  async function downloadPurchaseOrderPdf() {
    if (!doc || doc.type !== 'order') return;
    setOutputBusy('pdf');
    try {
      const element = pdfDoc();
      if (!element) throw new Error('Purchase order template is unavailable');
      await documentExporter.download({ element, fileName: doc.number, paper: pdfPaper });
      success(tPrint('downloaded_ok'));
    } catch {
      errorToast(tPrint('export_failed'));
    } finally {
      setOutputBusy(null);
    }
  }

  async function sharePurchaseOrderPdf() {
    if (!doc || doc.type !== 'order') return;
    setOutputBusy('share');
    try {
      const element = pdfDoc();
      if (!element) throw new Error('Purchase order template is unavailable');
      const result = await documentExporter.share({
        element,
        fileName: doc.number,
        title: t('order.document_title'),
        paper: pdfPaper,
      });
      success(result === 'shared' ? tPrint('shared_ok') : tPrint('downloaded_ok'));
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') errorToast(tPrint('export_failed'));
    } finally {
      setOutputBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('back')}><Link href={route}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Link></Button>
        <h1 className="num text-xl font-semibold text-text">{doc.number}</h1>
        <Badge tone={statusTone(doc.status)}>{t(`status_${doc.status}`)}</Badge>
        {doc.print_issued_at && <Badge tone="neutral">{t('issued')}</Badge>}

        <div className="ms-auto flex flex-wrap gap-2">
          {isPurchaseOrder && (
            <>
              <Button variant="outline" size="sm" onClick={() => setPreview((value) => !value)} disabled={busy || !!outputBusy}>
                {preview ? <EyeOff className="h-4 w-4" strokeWidth={1.7} /> : <Eye className="h-4 w-4" strokeWidth={1.7} />}
                {preview ? t('hide_preview') : tPrint('preview')}
              </Button>
              <Button variant="outline" size="sm" onClick={downloadPurchaseOrderPdf} disabled={busy || !!outputBusy}>
                <Download className="h-4 w-4" strokeWidth={1.7} />
                {outputBusy === 'pdf' ? tPrint('generating') : tPrint('download_pdf')}
              </Button>
              <Button variant="outline" size="sm" onClick={sharePurchaseOrderPdf} disabled={busy || !!outputBusy}>
                <Share2 className="h-4 w-4" strokeWidth={1.7} />
                {outputBusy === 'share' ? tPrint('generating') : tPrint('share_pdf')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => printDocument(paper, printRootId)} disabled={busy || !!outputBusy}>
                <Printer className="h-4 w-4" strokeWidth={1.7} />
                {t('print')}
              </Button>
            </>
          )}

          {type === 'order' && (doc.print_issued_at ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={revise}>
              <CopyPlus className="h-4 w-4" strokeWidth={1.7} />
              {t('create_revision')}
            </Button>
          ) : doc.status === 'approved' && (
            <Button variant="outline" size="sm" disabled={busy} onClick={issue}>
              <FileOutput className="h-4 w-4" strokeWidth={1.7} />
              {t('issue')}
            </Button>
          ))}

          {!doc.print_issued_at && NEXT_STATUSES[doc.status].map((next) => (
            <Button
              key={next}
              size="sm"
              variant={next === 'cancelled' || next === 'rejected' ? 'outline' : 'primary'}
              disabled={busy}
              onClick={() => move(next)}
            >
              {t(`action_${next}`)}
            </Button>
          ))}

          {canConvert(doc.status) && NEXT_TARGETS[type].map((target) => (
            <Button key={target} size="sm" disabled={busy} onClick={() => convert(target)}>
              <ArrowLeftRight className="h-4 w-4" strokeWidth={1.7} />
              {t(`convert_to_${target}`)}
            </Button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>{t('details')}</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {info.map(([label, value]) => (
              <div key={label} className="space-y-0.5">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="text-sm text-text">{value}</dd>
              </div>
            ))}
          </dl>
          {doc.notes && <p className="mt-3 text-sm text-muted">{doc.notes}</p>}
          {doc.print_issued_at && <p className="mt-3 border-t border-border pt-3 text-sm text-muted">{t('issued_locked_hint')}</p>}
          {doc.revised_from_number && <p className="mt-3 text-sm text-muted">{t('revised_from')}: <span className="num">{doc.revised_from_number}</span></p>}

          {(doc.source_document_id || doc.converted_purchase_id) && (
            <div className="mt-3 flex flex-wrap gap-4 border-t border-border pt-3 text-xs">
              {doc.source_document_id && doc.source_type && (
                <span className="text-muted">
                  {t('source')}:{' '}
                  <Link
                    href={`${PROCUREMENT_ROUTE[doc.source_type]}/${doc.source_document_id}`}
                    className="num text-primary hover:underline"
                  >
                    {doc.source_number ?? doc.source_document_id.slice(0, 8)}
                  </Link>
                </span>
              )}
              {doc.converted_purchase_id && (
                <Link href={`/purchases/${doc.converted_purchase_id}`} className="text-primary hover:underline">
                  {t('converted_purchase')}
                </Link>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('lines')}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-xs text-muted">
              <tr>
                <th className="p-3 text-start font-normal">{t('description')}</th>
                <th className="p-3 text-end font-normal">{t('qty')}</th>
                <th className="p-3 text-end font-normal">{t('unit_cost')}</th>
                <th className="p-3 text-end font-normal">{t('tax_total')}</th>
                <th className="p-3 text-end font-normal">{t('total')}</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className="p-3 text-text">{l.description ?? '—'}</td>
                  <td className="num p-3 text-end">{l.quantity}</td>
                  <td className="num p-3 text-end">{formatRiyal(l.unit_price)}</td>
                  <td className="num p-3 text-end text-muted">{formatRiyal(l.line_tax)}</td>
                  <td className="num p-3 text-end">{formatRiyal(l.line_total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="text-sm">
              <tr>
                <td colSpan={3} />
                <td className="p-3 text-end text-muted">{t('subtotal')}</td>
                <td className="num p-3 text-end">{formatRiyal(doc.subtotal)}</td>
              </tr>
              <tr>
                <td colSpan={3} />
                <td className="p-3 text-end text-muted">{t('tax_total')}</td>
                <td className="num p-3 text-end">{formatRiyal(doc.tax_amount)}</td>
              </tr>
              <tr className="border-t border-border">
                <td colSpan={3} />
                <td className="p-3 text-end font-semibold text-text">{t('total')}</td>
                <td className="num p-3 text-end text-lg font-bold text-text">{formatRiyal(doc.total)}</td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>

      {isPurchaseOrder && (
        <Card className={preview ? undefined : 'hidden print:block'}>
          <CardHeader className="no-print"><CardTitle>{tPrint('preview')}</CardTitle></CardHeader>
          <CardContent className="print:p-0">
            <div className="rounded-lg border border-border bg-surface p-3 print:border-0 print:bg-transparent print:p-0">
              <DocumentScaler>
                <PurchaseOrderDocument
                  order={doc}
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
                  rootId={printRootId}
                />
              </DocumentScaler>
            </div>
          </CardContent>
        </Card>
      )}

      {isPurchaseOrder && !pdfSharesPrintRoot && pdfOutput && (
        <PurchaseOrderDocument
          order={doc}
          company={company}
          supplier={supplier}
          {...documentPropsFromResolved(pdfOutput)}
          rootId="pdf-print-root"
        />
      )}

      <RevisionLog type="procurement" id={id} />
    </div>
  );
}
