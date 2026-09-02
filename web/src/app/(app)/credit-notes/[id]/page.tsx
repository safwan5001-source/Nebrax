'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Printer, Download, CheckCircle2, Share2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { CreditNoteDocument, type CreditNoteCompany, type CreditNoteCustomer } from '@/components/credit-notes/credit-note-document';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { documentExporter, printDocument } from '@/modules/documents/services/export';
import { getTemplate, DEFAULT_TEMPLATE_ID } from '@/modules/documents/registry/templates';
import { PAPER_SIZES } from '@/modules/documents/constants/paper';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import {
  resolveCreditNoteTemplateDesign,
  resolveLiveCreditNoteTemplateDesign,
  type CreditNoteTemplateDefinition,
  type ResolvedCreditNoteTemplateDesign,
} from '@/modules/credit-notes/services/credit-note-template-design';
import {
  resolveLiveTemplateDefinition,
  type LivePrintTemplateAssignment,
  type ResolvedLiveTemplate,
} from '@/modules/print-templates/services/live-template-definition';
import { resolveDocumentOutputTemplates } from '@/modules/print-templates/services/document-output-template';
import type { ThemeId, DocSectionLayoutItem } from '@/modules/documents/types';

interface Line { id: string; description: string | null; quantity: number; unit_price: string; line_tax: string; line_total: string }
interface FrozenPrintTemplateRevision {
  id: string;
  definition?: Record<string, unknown>;
}

interface CreditNote {
  id: string; branch_id: string | null; number: string; partner_id: string; type?: 'sales' | 'purchase'; refund_type: string; status: string;
  note_date: string; subtotal: string; tax_amount: string; total: string; reason: string | null; lines: Line[];
  print_template_revision_id?: string | null;
  print_template_revision?: FrozenPrintTemplateRevision | null;
  pdf_template_revision_id?: string | null;
  pdf_template_revision?: FrozenPrintTemplateRevision | null;
  thermal_template_revision_id?: string | null;
  thermal_template_revision?: FrozenPrintTemplateRevision | null;
}

const statusTone: Record<string, 'positive' | 'muted' | 'negative'> = { posted: 'positive', draft: 'muted', cancelled: 'negative' };

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

export default function CreditNoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('creditNotes');
  const tPrint = useTranslations('documentPrint');
  const tc = useTranslations('common');
  const { success, error: errorToast } = useToast();

  const [note, setNote] = useState<CreditNote | null>(null);
  const [customer, setCustomer] = useState<CreditNoteCustomer | null>(null);
  const [company, setCompany] = useState<CreditNoteCompany | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [busy, setBusy] = useState<null | 'pdf' | 'share'>(null);
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
  const [pdfOutput, setPdfOutput] = useState<ResolvedLiveTemplate | null>(null);
  const [pdfSharesPrintRoot, setPdfSharesPrintRoot] = useState(true);

  function applyPrint(resolved: ResolvedLiveTemplate | null) {
    if (!resolved) {
      setTemplateId(DEFAULT_TEMPLATE_ID);
      setThemeId(null);
      setFooterText(null);
      setShowLogo(true);
      setLogoUrl(null);
      setLogoHeight(null);
      setLayout(null);
      setTermsText(null);
      setBankText(null);
      setStampUrl(null);
      setSignatureUrl(null);
      return;
    }
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

  function applyDebitDesign(design: ResolvedCreditNoteTemplateDesign) {
    setTemplateId(design.templateId);
    setThemeId(design.themeId);
    setFooterText(design.footerText);
    setShowLogo(design.showLogo);
    setLogoUrl(design.logoUrl);
    setLogoHeight(design.logoHeight);
    setLayout(design.layout);
    setTermsText(design.termsText);
    setBankText(design.bankText);
    setStampUrl(design.stampUrl);
    setSignatureUrl(design.signatureUrl);
    setPdfOutput(null);
    setPdfSharesPrintRoot(true);
  }

  function load() {
    setLoading(true);
    api<{ data: CreditNote }>(`/credit-notes/${id}`)
      .then(async (r) => {
        setNote(r.data);
        const isSalesCreditNote = r.data.type !== 'purchase';
        const documentType = isSalesCreditNote ? 'credit_note' : 'debit_note';
        const branchQuery = r.data.branch_id ? `&branch_id=${encodeURIComponent(r.data.branch_id)}` : '';
        const skipped = Promise.resolve({ data: null as LivePrintTemplateAssignment | null });
        const resolveUsage = (usage: 'print' | 'pdf') => (
          api<{ data: LivePrintTemplateAssignment | null }>(
            `/print-templates/resolve?document_type=${documentType}&usage=${usage}${branchQuery}`,
          )
        );
        const posted = r.data.status === 'posted';

        if (!isSalesCreditNote) {
          const [p, m, live] = await Promise.allSettled([
            api<{ data: CreditNoteCustomer }>(`/partners/${r.data.partner_id}`),
            api<{ company: CreditNoteCompany }>(`/me`),
            api<{ data: LivePrintTemplateAssignment | null }>(
              `/print-templates/resolve?document_type=${documentType}&usage=print${branchQuery}`,
            ),
          ]);
          if (p.status === 'fulfilled') setCustomer(p.value.data);
          if (m.status === 'fulfilled') setCompany(m.value.company);
          const frozen = (r.data.print_template_revision?.definition as CreditNoteTemplateDefinition | undefined) ?? null;
          const liveDesign = frozen || live.status !== 'fulfilled'
            ? null
            : resolveLiveCreditNoteTemplateDesign(
              resolveLiveTemplateDefinition(live.value.data, documentType),
            );
          applyDebitDesign(
            frozen
              ? resolveCreditNoteTemplateDesign(frozen, null)
              : liveDesign ?? resolveCreditNoteTemplateDesign(null, null),
          );
          return;
        }

        const [p, m, livePrint, livePdf] = await Promise.allSettled([
          api<{ data: CreditNoteCustomer }>(`/partners/${r.data.partner_id}`),
          api<{ company: CreditNoteCompany }>(`/me`),
          posted ? skipped : resolveUsage('print'),
          posted ? skipped : resolveUsage('pdf'),
        ]);
        if (p.status === 'fulfilled') setCustomer(p.value.data);
        if (m.status === 'fulfilled') setCompany(m.value.company);

        const outputs = resolveDocumentOutputTemplates({
          documentType: 'credit_note',
          isPosted: posted,
          frozenPrint: r.data.print_template_revision,
          frozenPdf: r.data.pdf_template_revision,
          livePrint: liveAssignment(livePrint),
          livePdf: liveAssignment(livePdf),
        });
        applyPrint(outputs.print);
        setPdfOutput(outputs.pdf);
        setPdfSharesPrintRoot(outputs.pdfSharesPrintRoot);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [id]);

  async function post() {
    setPosting(true);
    try {
      await api(`/credit-notes/${id}/post`, { method: 'POST' });
      success(tc('updated'));
      load();
    } catch (e) {
      errorToast(e instanceof ApiError ? e.message : tc('saveFailed'));
    } finally {
      setPosting(false);
    }
  }

  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /></div>;
  }
  if (!note) return <div className="text-muted">{t('not_found')}</div>;

  const isDebitNote = note.type === 'purchase';
  const isSalesCreditNote = !isDebitNote;
  const counterpartLabel = isDebitNote ? t('supplier') : t('partner');
  const treatmentLabel = isDebitNote
    ? t('debit_document_subtitle')
    : (note.refund_type === 'cash' ? t('refund_cash') : t('refund_credit'));
  const info: [string, React.ReactNode][] = [
    [counterpartLabel, customer?.name ?? '—'],
    [t('refund_type'), treatmentLabel],
    [t('date'), <span key="d" className="num">{note.note_date}</span>],
    [t('total'), <span key="t" className="num font-semibold">{formatRiyal(note.total)}</span>],
  ];

  const paperId = getTemplate(templateId).supportedPaper[0] ?? 'a4';
  const paper = { widthMm: PAPER_SIZES[paperId].widthMm, heightMm: PAPER_SIZES[paperId].heightMm };
  const pdfPaperId = (isSalesCreditNote && pdfOutput ? getTemplate(pdfOutput.templateId).supportedPaper[0] : paperId) ?? 'a4';
  const pdfPaper = { widthMm: PAPER_SIZES[pdfPaperId].widthMm, heightMm: PAPER_SIZES[pdfPaperId].heightMm };
  const pdfDoc = () => document.getElementById(
    isSalesCreditNote && !pdfSharesPrintRoot ? 'pdf-print-root' : 'print-root',
  );
  const frozenThermalDefinition = (note.thermal_template_revision?.definition as CreditNoteTemplateDefinition | undefined) ?? null;
  const thermalTemplateId = frozenThermalDefinition?.template_id ?? null;
  const thermalPaperId = thermalTemplateId
    ? getTemplate(thermalTemplateId).supportedPaper.find((candidate) => candidate.startsWith('thermal_'))
    : null;
  const thermalPaper = thermalPaperId
    ? { widthMm: PAPER_SIZES[thermalPaperId].widthMm, heightMm: PAPER_SIZES[thermalPaperId].heightMm }
    : null;

  async function handleDownloadPdf() {
    if (!note) return;
    setBusy('pdf');
    try {
      const element = pdfDoc();
      if (!element) throw new Error('Credit note template is unavailable');
      await documentExporter.download({ element, fileName: note.number, paper: pdfPaper });
      success(tPrint('downloaded_ok'));
    } catch {
      errorToast(tPrint('export_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function handleShare() {
    if (!note) return;
    setBusy('share');
    try {
      const element = pdfDoc();
      if (!element) throw new Error('Credit note template is unavailable');
      const result = await documentExporter.share({
        element,
        fileName: note.number,
        title: note.type === 'purchase' ? t('debit_document_title') : t('document_title'),
        paper: pdfPaper,
      });
      success(result === 'shared' ? tPrint('shared_ok') : tPrint('downloaded_ok'));
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') errorToast(tPrint('export_failed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="no-print" aria-label={t('back')}><Link href='/credit-notes'>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Link></Button>
        <h1 className="num text-xl font-semibold text-text">{note.number}</h1>
        <Badge tone={statusTone[note.status] ?? 'muted'}>{t(note.status)}</Badge>
        <div className="no-print ms-auto flex flex-wrap gap-2">
          {note.status === 'draft' && (
            <Button size="sm" disabled={posting} onClick={post}>
              <CheckCircle2 className="h-4 w-4" strokeWidth={1.7} />
              {t('post')}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleDownloadPdf} disabled={!!busy}>
            <Download className="h-4 w-4" strokeWidth={1.7} />
            {busy === 'pdf' ? tPrint('generating') : tPrint('download_pdf')}
          </Button>
          <Button variant="outline" size="sm" onClick={handleShare} disabled={!!busy}>
            <Share2 className="h-4 w-4" strokeWidth={1.7} />
            {busy === 'share' ? tPrint('generating') : tPrint('share_pdf')}
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

      <Card>
        <CardHeader><CardTitle>{t('details')}</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {info.map(([k, v]) => (
              <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="text-text">{v}</dd></div>
            ))}
          </dl>
          {note.reason && <p className="mt-3 border-t border-border pt-3 text-sm text-muted">{note.reason}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="no-print"><CardTitle>{tPrint('preview')}</CardTitle></CardHeader>
        <CardContent className="print:p-0">
          <div className="rounded-lg bg-gray-100 p-3 dark:bg-black/30 print:bg-transparent print:p-0">
            <DocumentScaler>
              <CreditNoteDocument
                note={note}
                company={company}
                customer={customer}
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

      {isSalesCreditNote && !pdfSharesPrintRoot && pdfOutput && (
        <CreditNoteDocument
          note={note}
          company={company}
          customer={customer}
          {...documentPropsFromResolved(pdfOutput)}
          rootId="pdf-print-root"
        />
      )}

      {frozenThermalDefinition && thermalPaper && thermalTemplateId && (
        <CreditNoteDocument
          note={note}
          company={company}
          customer={customer}
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
    </div>
  );
}
