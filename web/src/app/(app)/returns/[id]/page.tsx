'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Printer, Download, Share2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { TaxDocument, type Party, type DocLine } from '@/components/documents/tax-document';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { useCompany } from '@/lib/company';
import { useToast } from '@/components/ui/toast';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import { documentExporter, printDocument } from '@/modules/documents/services/export';

interface ReturnDoc {
  id: string;
  number: string;
  type: 'sales' | 'purchase';
  partner_id: string;
  payment_type: string;
  status: string;
  return_date: string;
  subtotal: string;
  tax_amount: string;
  total: string;
  lines: DocLine[];
}

const statusTone: Record<string, 'positive' | 'muted' | 'negative'> = { posted: 'positive', draft: 'muted', cancelled: 'negative' };

export default function ReturnDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('invoiceDetail');
  const tr = useTranslations('returns');
  const ts = useTranslations('status');
  const tPrint = useTranslations('documentPrint');
  const company = useCompany();
  const { success, error: errorToast } = useToast();

  const [doc, setDoc] = useState<ReturnDoc | null>(null);
  const [party, setParty] = useState<Party | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | 'pdf' | 'share'>(null);

  useEffect(() => {
    setLoading(true);
    api<{ data: ReturnDoc }>(`/returns/${id}`)
      .then(async (r) => {
        setDoc(r.data);
        const p = await api<{ data: Party }>(`/partners/${r.data.partner_id}`).catch(() => null);
        if (p) setParty(p.data);
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

  if (!doc) return <div className="text-muted">{t('not_found')}</div>;

  // مرتجع مبيعات = إشعار دائن للعميل، ومرتجع مشتريات = إشعار مدين للمورد.
  const isPurchaseReturn = doc.type === 'purchase';
  const docTitle = isPurchaseReturn ? tr('doc_title_debit') : tr('doc_title_credit');
  const docSubtitle = isPurchaseReturn ? tr('document_subtitle_debit') : tr('document_subtitle_credit');
  const partyLabel = isPurchaseReturn ? tr('supplier') : tr('customer');
  const paper = { widthMm: 210, heightMm: 297 };

  const info: [string, React.ReactNode][] = [
    [tr('partner'), party?.name ?? '—'],
    [tr('type'), tr(doc.type)],
    [t('date'), <span key="d" className="num">{doc.return_date}</span>],
    [tr('total'), <span key="t" className="num font-semibold">{formatRiyal(doc.total)}</span>],
  ];

  async function handleDownloadPdf() {
    if (!doc) return;
    setBusy('pdf');
    try {
      const element = document.getElementById('print-root');
      if (!element) throw new Error('Return template is unavailable');
      await documentExporter.download({ element, fileName: doc.number, paper });
      success(tPrint('downloaded_ok'));
    } catch {
      errorToast(tPrint('export_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function handleShare() {
    if (!doc) return;
    setBusy('share');
    try {
      const element = document.getElementById('print-root');
      if (!element) throw new Error('Return template is unavailable');
      const result = await documentExporter.share({ element, fileName: doc.number, title: docTitle, paper });
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
        <Button variant="ghost" size="icon" className="no-print" onClick={() => router.push('/returns')} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="num text-xl font-semibold text-text">{doc.number}</h1>
        <Badge tone={doc.type === 'sales' ? 'neutral' : 'warning'}>{tr(doc.type)}</Badge>
        <Badge tone={statusTone[doc.status] ?? 'muted'}>{ts(doc.status)}</Badge>
        <div className="no-print ms-auto flex flex-wrap gap-2">
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
        <CardHeader>
          <CardTitle>{tr('details')}</CardTitle>
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
          <CardTitle>{tr('lines')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>{t('description')}</TH>
                <TH className="text-end">{t('qty')}</TH>
                <TH className="text-end">{t('unit_price')}</TH>
                <TH className="text-end">{t('tax')}</TH>
                <TH className="text-end">{tr('total')}</TH>
              </TR>
            </THead>
            <TBody>
              {doc.lines.map((l) => (
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

      <Card>
        <CardHeader className="no-print"><CardTitle>{tr('preview')}</CardTitle></CardHeader>
        <CardContent className="print:p-0">
          <div className="rounded-lg bg-gray-100 p-3 dark:bg-black/30 print:bg-transparent print:p-0 [&_.print-only]:block">
            <DocumentScaler>
              <TaxDocument
                title={docTitle}
                subtitle={docSubtitle}
                company={company}
                partyLabel={partyLabel}
                party={party}
                metaRows={[
                  [tr('number'), doc.number],
                  [t('date'), doc.return_date],
                  [tr('type'), tr(doc.type)],
                ]}
                lines={doc.lines}
                subtotal={doc.subtotal}
                tax={doc.tax_amount}
                total={doc.total}
              />
            </DocumentScaler>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
