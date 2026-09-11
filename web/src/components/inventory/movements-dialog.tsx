'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

interface MovementSource {
  type: string;
  label: string;
  reference: string | null;
  date: string | null;
  status: string | null;
  can_open: boolean;
  route: string | null;
}

interface Movement {
  id: string;
  type: string;
  quantity: number;
  unit_cost: string | null;
  total_cost: string | null;
  balance_quantity: number;
  movement_date: string | null;
  notes: string | null;
  source?: MovementSource | null;
}

const typeTone: Record<string, 'positive' | 'warning' | 'muted'> = { in: 'positive', out: 'warning', adjustment: 'muted' };

export function MovementsDialog({ product, onClose }: { product: { id: string; name: string } | null; onClose: () => void }) {
  const t = useTranslations('inventory');
  const locale = useLocale();
  const sourceHeading = locale.startsWith('en') ? 'Source' : 'المصدر';
  const openSourceLabel = locale.startsWith('en') ? 'Open source' : 'فتح المصدر';
  const [rows, setRows] = useState<Movement[] | null>(null);

  useEffect(() => {
    if (!product) {
      setRows(null);
      return;
    }
    setRows(null);
    api<{ data: Movement[] }>(`/inventory/${product.id}/movements`).then((r) => setRows(r.data)).catch(() => setRows([]));
  }, [product]);

  if (!product) return null;

  return (
    <Dialog open={!!product} onClose={onClose} title={`${t('movements')} — ${product.name}`} className="max-w-3xl">
      {!rows ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">{t('empty')}</p>
      ) : (
        <div className="max-h-80 overflow-auto rounded border border-border">
          <Table>
            <THead>
              <TR>
                <TH>{t('date')}</TH>
                <TH>{t('type')}</TH>
                <TH>{sourceHeading}</TH>
                <TH className="text-end">{t('qty')}</TH>
                <TH className="text-end">{t('avg_cost')}</TH>
                <TH className="text-end">{t('stock_value')}</TH>
                <TH className="text-end">{t('balance')}</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((m) => (
                <TR key={m.id}>
                  <TD className="num text-muted">{m.movement_date ?? '—'}</TD>
                  <TD><Badge tone={typeTone[m.type] ?? 'muted'}>{t(m.type)}</Badge></TD>
                  <TD>
                    {m.source ? (
                      <div className="min-w-[9rem]">
                        <div className="text-sm text-text">{m.source.label}</div>
                        {m.source.reference ? (
                          <div className="num text-xs text-muted">{m.source.reference}</div>
                        ) : null}
                        {m.source.can_open && m.source.route ? (
                          <Link href={m.source.route} className="mt-0.5 inline-block text-xs text-primary hover:underline">
                            {openSourceLabel}
                          </Link>
                        ) : null}
                      </div>
                    ) : '—'}
                  </TD>
                  <TD className="num text-end">{m.quantity}</TD>
                  <TD className="num text-end">{formatRiyal(m.unit_cost)}</TD>
                  <TD className="num text-end">{formatRiyal(m.total_cost)}</TD>
                  <TD className="num text-end font-medium">{m.balance_quantity}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </Dialog>
  );
}
