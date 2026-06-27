'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Printer, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

interface Line { id: string; description: string | null; quantity: number; unit_price: string; line_tax: string; line_total: string }
interface CreditNote {
  id: string; number: string; partner_id: string; refund_type: string; status: string;
  note_date: string; subtotal: string; tax_amount: string; total: string; reason: string | null; lines: Line[];
}
interface Party { id: string; name: string }

const statusTone: Record<string, 'positive' | 'muted' | 'negative'> = { posted: 'positive', draft: 'muted', cancelled: 'negative' };

export default function CreditNoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('creditNotes');
  const tf = useTranslations('invoiceForm');
  const tc = useTranslations('common');
  const { success } = useToast();

  const [note, setNote] = useState<CreditNote | null>(null);
  const [partner, setPartner] = useState<Party | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);

  function load() {
    setLoading(true);
    api<{ data: CreditNote }>(`/credit-notes/${id}`)
      .then(async (r) => {
        setNote(r.data);
        const p = await api<{ data: Party }>(`/partners/${r.data.partner_id}`).catch(() => null);
        if (p) setPartner(p.data);
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
      alert(e instanceof ApiError ? e.message : tc('saveFailed'));
    } finally {
      setPosting(false);
    }
  }

  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /></div>;
  }
  if (!note) return <div className="text-muted">{t('not_found')}</div>;

  const info: [string, React.ReactNode][] = [
    [t('partner'), partner?.name ?? '—'],
    [t('refund_type'), note.refund_type === 'cash' ? t('refund_cash') : t('refund_credit')],
    [t('date'), <span key="d" className="num">{note.note_date}</span>],
    [t('total'), <span key="t" className="num font-semibold">{formatRiyal(note.total)}</span>],
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" className="no-print" onClick={() => router.push('/credit-notes')} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="num text-xl font-semibold text-text">{note.number}</h1>
        <Badge tone={statusTone[note.status] ?? 'muted'}>{t(note.status)}</Badge>
        <div className="no-print ms-auto flex gap-2">
          {note.status === 'draft' && (
            <Button size="sm" disabled={posting} onClick={post}>
              <CheckCircle2 className="h-4 w-4" strokeWidth={1.7} />
              {t('post')}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => window.print()}>
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

      <Card>
        <CardHeader><CardTitle>{t('lines')}</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>{tf('description')}</TH>
                <TH className="text-end">{tf('qty')}</TH>
                <TH className="text-end">{tf('price')}</TH>
                <TH className="text-end">{tf('tax')}</TH>
                <TH className="text-end">{t('total')}</TH>
              </TR>
            </THead>
            <TBody>
              {note.lines.map((l) => (
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
    </div>
  );
}
