'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Printer, Download, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { CreditNoteDocument, type CreditNoteCompany, type CreditNoteCustomer } from '@/components/credit-notes/credit-note-document';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { documentExporter, printDocument } from '@/modules/documents/services/export';
import { getTemplate } from '@/modules/documents/registry/templates';
import { PAPER_SIZES } from '@/modules/documents/constants/paper';
import type { ThemeId } from '@/modules/documents/types';

interface Line { id: string; description: string | null; quantity: number; unit_price: string; line_tax: string; line_total: string }
interface CreditNote {
  id: string; number: string; partner_id: string; refund_type: string; status: string;
  note_date: string; subtotal: string; tax_amount: string; total: string; reason: string | null; lines: Line[];
}

const statusTone: Record<string, 'positive' | 'muted' | 'negative'> = { posted: 'positive', draft: 'muted', cancelled: 'negative' };

export default function CreditNoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('creditNotes');
  const td = useTranslations('invoiceDetail');
  const tc = useTranslations('common');
  const { success, error: errorToast } = useToast();

  const [note, setNote] = useState<CreditNote | null>(null);
  const [customer, setCustomer] = useState<CreditNoteCustomer | null>(null);
  const [company, setCompany] = useState<CreditNoteCompany | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [templateId, setTemplateId] = useState<string>('tax-invoice-classic');
  const [themeId, setThemeId] = useState<ThemeId | null>(null);
  const [footerText, setFooterText] = useState<string | null>(null);
  const [showLogo, setShowLogo] = useState(true);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoHeight, setLogoHeight] = useState<number | null>(null);

  function load() {
    setLoading(true);
    api<{ data: CreditNote }>(`/credit-notes/${id}`)
      .then(async (r) => {
        setNote(r.data);
        const [p, m, d] = await Promise.allSettled([
          api<{ data: CreditNoteCustomer }>(`/partners/${r.data.partner_id}`),
          api<{ company: CreditNoteCompany }>(`/me`),
          api<{ data: { template?: string; theme?: string; footer_text?: string; show_logo?: boolean; logo?: string; logo_height?: number } }>(`/sales-config/designs`),
        ]);
        if (p.status === 'fulfilled') setCustomer(p.value.data);
        if (m.status === 'fulfilled') setCompany(m.value.company);
        if (d.status === 'fulfilled') {
          const dg = d.value.data ?? {};
          setTemplateId(getTemplate(`tax-invoice-${dg.template ?? ''}`).id);
          if (dg.theme) setThemeId(dg.theme as ThemeId);
          setFooterText(dg.footer_text ?? null);
          setShowLogo(dg.show_logo !== false);
          setLogoUrl(dg.logo ?? null);
          setLogoHeight(dg.logo_height ?? null);
        }
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

  const info: [string, React.ReactNode][] = [
    [t('partner'), customer?.name ?? '—'],
    [t('refund_type'), note.refund_type === 'cash' ? t('refund_cash') : t('refund_credit')],
    [t('date'), <span key="d" className="num">{note.note_date}</span>],
    [t('total'), <span key="t" className="num font-semibold">{formatRiyal(note.total)}</span>],
  ];

  const paperId = getTemplate(templateId).supportedPaper[0] ?? 'a4';
  const paper = { widthMm: PAPER_SIZES[paperId].widthMm, heightMm: PAPER_SIZES[paperId].heightMm };

  async function handleDownloadPdf() {
    const el = document.getElementById('print-root');
    if (!el || !note) return;
    setBusy(true);
    try {
      await documentExporter.download({ element: el, fileName: note.number, paper });
      success(td('downloaded_ok'));
    } catch {
      errorToast(td('export_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" className="no-print" onClick={() => router.push('/credit-notes')} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="num text-xl font-semibold text-text">{note.number}</h1>
        <Badge tone={statusTone[note.status] ?? 'muted'}>{t(note.status)}</Badge>
        <div className="no-print ms-auto flex flex-wrap gap-2">
          {note.status === 'draft' && (
            <Button size="sm" disabled={posting} onClick={post}>
              <CheckCircle2 className="h-4 w-4" strokeWidth={1.7} />
              {t('post')}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleDownloadPdf} disabled={busy}>
            <Download className="h-4 w-4" strokeWidth={1.7} />
            {busy ? td('generating') : td('download_pdf')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => printDocument(paper)} disabled={busy}>
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
          {note.reason && <p className="mt-3 border-t border-border pt-3 text-sm text-muted">{note.reason}</p>}
        </CardContent>
      </Card>

      {/* معاينة مستند الإشعار الدائن (مرئية + مصدر الطباعة/الـ PDF) عبر محرّك المستندات. */}
      <Card>
        <CardHeader className="no-print"><CardTitle>{td('preview')}</CardTitle></CardHeader>
        <CardContent className="print:p-0">
          <div className="overflow-x-auto rounded-lg bg-gray-100 p-3 dark:bg-black/30 print:bg-transparent print:p-0">
            <CreditNoteDocument
              note={note}
              company={company}
              customer={customer}
              templateId={templateId}
              themeId={themeId}
              footerText={footerText}
              showLogo={showLogo}
              logoUrl={logoUrl}
              logoHeight={logoHeight}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
