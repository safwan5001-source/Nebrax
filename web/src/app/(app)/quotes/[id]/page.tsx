'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Printer, Download, FileCheck, Share2, CopyPlus, FileOutput } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { QuoteDocument, type QuoteCompany, type QuoteCustomer } from '@/components/quotes/quote-document';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { documentExporter, printDocument } from '@/modules/documents/services/export';
import { getTemplate } from '@/modules/documents/registry/templates';
import { PAPER_SIZES } from '@/modules/documents/constants/paper';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import { RevisionLog } from '@/components/documents/revision-log';
import type { ThemeId, DocSectionLayoutItem } from '@/modules/documents/types';
import { resolveLiveTemplateDefinition, type LivePrintTemplateAssignment } from '@/modules/print-templates/services/live-template-definition';

interface Line { id: string; description: string | null; quantity: number; unit_price: string; line_tax: string; line_total: string }
interface FrozenPrintTemplateRevision {
  id: string;
  definition?: Record<string, unknown>;
}

interface Quote {
  id: string; branch_id: string | null; number: string; partner_id: string; status: string;
  quote_date: string; valid_until: string | null;
  subtotal: string; tax_amount: string; total: string; notes: string | null;
  converted_invoice_id: string | null; print_issued_at: string | null;
  print_template_revision: FrozenPrintTemplateRevision | null;
  pdf_template_revision: FrozenPrintTemplateRevision | null;
  revised_from_id: string | null; revised_from_number?: string | null;
  lines: Line[];
}

const statusTone: Record<string, 'positive' | 'warning' | 'muted' | 'negative' | 'neutral'> = {
  draft: 'muted', sent: 'neutral', accepted: 'positive', rejected: 'negative', converted: 'positive',
};

export default function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('quotes');
  const tPrint = useTranslations('documentPrint');
  const tc = useTranslations('common');
  const { success, error: errorToast } = useToast();

  const [quote, setQuote] = useState<Quote | null>(null);
  const [customer, setCustomer] = useState<QuoteCustomer | null>(null);
  const [company, setCompany] = useState<QuoteCompany | null>(null);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [revising, setRevising] = useState(false);
  const [busy, setBusy] = useState<null | 'pdf' | 'share'>(null);
  const [templateId, setTemplateId] = useState<string>('tax-invoice-classic');
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

  function resetTemplate() {
    setTemplateId('tax-invoice-classic');
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
  }

  function applyTemplate(assignment: LivePrintTemplateAssignment | null) {
    const resolved = resolveLiveTemplateDefinition(assignment, 'quotation');
    if (!resolved) {
      resetTemplate();
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

  function load() {
    setLoading(true);
    api<{ data: Quote }>(`/quotes/${id}`)
      .then(async (r) => {
        setQuote(r.data);
        const [p, m] = await Promise.allSettled([
          api<{ data: QuoteCustomer }>(`/partners/${r.data.partner_id}`),
          api<{ company: QuoteCompany }>(`/me`),
        ]);
        if (p.status === 'fulfilled') setCustomer(p.value.data);
        if (m.status === 'fulfilled') setCompany(m.value.company);

        if (r.data.print_issued_at) {
          const frozen = r.data.print_template_revision ?? r.data.pdf_template_revision;
          applyTemplate(frozen ? {
            print_template_revision_id: frozen.id,
            revision: frozen,
          } : null);
          return;
        }

        const branchQuery = r.data.branch_id ? `&branch_id=${encodeURIComponent(r.data.branch_id)}` : '';
        const live = await api<{ data: LivePrintTemplateAssignment | null }>(
          `/print-templates/resolve?document_type=quotation&usage=print${branchQuery}`,
        ).catch(() => null);
        applyTemplate(live?.data ?? null);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [id]);

  async function issue() {
    setIssuing(true);
    try {
      await api(`/quotes/${id}/issue`, { method: 'POST' });
      success(tc('updated'));
      load();
    } catch (e) {
      errorToast(e instanceof ApiError ? e.message : tc('saveFailed'));
    } finally {
      setIssuing(false);
    }
  }

  async function revise() {
    setRevising(true);
    try {
      const revision = await api<{ data: { id: string } }>(`/quotes/${id}/revise`, { method: 'POST' });
      success(tc('created'));
      router.push(`/quotes/${revision.data.id}`);
    } catch (e) {
      errorToast(e instanceof ApiError ? e.message : tc('saveFailed'));
      setRevising(false);
    }
  }

  async function convert() {
    setConverting(true);
    try {
      const inv = await api<{ data: { id: string } }>(`/quotes/${id}/convert`, { method: 'POST', body: { payment_type: 'credit' } });
      success(tc('created'));
      router.push(`/invoices/${inv.data.id}`);
    } catch (e) {
      setConverting(false);
      errorToast(e instanceof ApiError ? e.message : tc('saveFailed'));
    }
  }

  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /></div>;
  }
  if (!quote) return <div className="text-muted">{t('not_found')}</div>;

  const info: [string, React.ReactNode][] = [
    [t('partner'), customer?.name ?? '—'],
    [t('date'), <span key="d" className="num">{quote.quote_date}</span>],
    [t('valid_until'), <span key="v" className="num">{quote.valid_until ?? '—'}</span>],
    [t('total'), <span key="t" className="num font-semibold">{formatRiyal(quote.total)}</span>],
  ];

  const paperId = getTemplate(templateId).supportedPaper[0] ?? 'a4';
  const paper = { widthMm: PAPER_SIZES[paperId].widthMm, heightMm: PAPER_SIZES[paperId].heightMm };

  async function handleDownloadPdf() {
    if (!quote) return;
    setBusy('pdf');
    try {
      const element = document.getElementById('print-root');
      if (!element) throw new Error('Quote template is unavailable');
      await documentExporter.download({ element, fileName: quote.number, paper });
      success(tPrint('downloaded_ok'));
    } catch {
      errorToast(tPrint('export_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function handleShare() {
    if (!quote) return;
    setBusy('share');
    try {
      const element = document.getElementById('print-root');
      if (!element) throw new Error('Quote template is unavailable');
      const result = await documentExporter.share({ element, fileName: quote.number, title: t('document_title'), paper });
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
        <Button asChild variant="ghost" size="icon" className="no-print" aria-label={t('back')}><Link href='/quotes'>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Link></Button>
        <h1 className="num text-xl font-semibold text-text">{quote.number}</h1>
        <Badge tone={statusTone[quote.status] ?? 'muted'}>{t(quote.status)}</Badge>
        {quote.print_issued_at && <Badge tone="neutral">{t('issued')}</Badge>}
        <div className="no-print ms-auto flex flex-wrap gap-2">
          {quote.print_issued_at ? (
            <Button variant="outline" size="sm" disabled={revising} onClick={revise}>
              <CopyPlus className="h-4 w-4" strokeWidth={1.7} />
              {t('create_revision')}
            </Button>
          ) : !quote.converted_invoice_id && (
            <Button variant="outline" size="sm" disabled={issuing} onClick={issue}>
              <FileOutput className="h-4 w-4" strokeWidth={1.7} />
              {t('issue')}
            </Button>
          )}
          {quote.converted_invoice_id ? (
            <Button asChild variant="outline" size="sm"><Link href={`/invoices/${quote.converted_invoice_id}`}>
              <FileCheck className="h-4 w-4" strokeWidth={1.7} />
              {t('view_invoice')}
            </Link></Button>
          ) : (
            <Button size="sm" disabled={converting} onClick={convert}>
              <FileCheck className="h-4 w-4" strokeWidth={1.7} />
              {t('convert')}
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
          <Button variant="outline" size="sm" onClick={() => printDocument(paper)} disabled={!!busy}>
            <Printer className="h-4 w-4" strokeWidth={1.7} />
            {t('print')}
          </Button>
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
          {quote.notes && <p className="mt-3 border-t border-border pt-3 text-sm text-muted">{quote.notes}</p>}
          {quote.print_issued_at && <p className="mt-3 border-t border-border pt-3 text-sm text-muted">{t('issued_locked_hint')}</p>}
          {quote.revised_from_number && <p className="mt-3 text-sm text-muted">{t('revised_from')}: <span className="num">{quote.revised_from_number}</span></p>}
        </CardContent>
      </Card>

      {/* معاينة مستند عرض السعر (مرئية + مصدر الطباعة/الـ PDF) عبر محرّك المستندات. */}
      <Card>
        <CardHeader className="no-print"><CardTitle>{tPrint('preview')}</CardTitle></CardHeader>
        <CardContent className="print:p-0">
          <div className="rounded-lg bg-gray-100 p-3 dark:bg-black/30 print:bg-transparent print:p-0">
            <DocumentScaler>
              <QuoteDocument
                quote={quote}
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

      {/* سجلّ التغييرات — لا يُطبع مع المستند. */}
      <RevisionLog type="quote" id={id} />
    </div>
  );
}
