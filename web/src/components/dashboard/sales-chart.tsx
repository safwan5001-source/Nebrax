'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AreaLine, RankedBars } from '@/components/charts/area-line';
import { api } from '@/lib/api';
import { toNumber } from '@/lib/dashboard';
import { formatRiyalShort } from '@/lib/money';
import { cn } from '@/lib/utils';

/** أبعاد التجميع — مرآة `DashboardService::DIMENSIONS`. */
const TABS = ['day', 'product', 'category', 'branch', 'salesperson'] as const;
type Dimension = (typeof TABS)[number];

interface Row { key: string | null; label: string; amount: string }

/**
 * رسم المبيعات بتبويباته الخمسة.
 *
 * **خطٌّ لليوم وأعمدة لما سواه** عن قصد: الزمن له ترتيب طبيعي فيُرسم خطاً،
 * أما المنتجات والفروع والبائعون فلا ترتيب بينها — وخطٌّ عبرها يوهم باتجاه
 * لا وجود له. الأعمدة تقارن مقادير، وهو السؤال الحقيقي في تلك التبويبات.
 */
export function SalesChart({ query }: { query: string }) {
  const t = useTranslations('dashboard');
  const [tab, setTab] = useState<Dimension>('day');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const sep = query.startsWith('?') ? '&' : '?';
    api<{ data: Row[] }>(`/dashboard/sales-breakdown${query}${query ? sep : '?'}by=${tab}`)
      .then((r) => setRows(r.data))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [tab, query]);

  useEffect(() => load(), [load]);

  const amounts = rows.map((r) => toNumber(r.amount));

  return (
    <Card className="rounded-2xl">
      <CardContent className="p-5">
        <h3 className="mb-4 text-[14.5px] font-semibold text-text">{t('sales_chart')}</h3>

        <div
          role="tablist"
          aria-label={t('sales_chart')}
          className="mb-4 flex gap-5 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {TABS.map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={tab === d}
              onClick={() => setTab(d)}
              className={cn(
                'shrink-0 whitespace-nowrap border-b-2 pb-3 text-[13.5px] font-semibold transition-colors',
                tab === d ? 'border-positive text-text' : 'border-transparent text-muted hover:text-text'
              )}
            >
              {t(`chart_${d}`)}
            </button>
          ))}
        </div>

        {loading ? (
          <Skeleton className="h-[180px] w-full" />
        ) : tab === 'day' ? (
          amounts.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted">{t('chart_empty')}</p>
          ) : (
            <AreaLine data={amounts} label={t('sales_chart')} className="w-full" />
          )
        ) : (
          <RankedBars
            rows={rows.map((r) => ({ label: r.label, amount: toNumber(r.amount) }))}
            format={(n) => formatRiyalShort(String(n))}
            emptyLabel={t('chart_empty')}
          />
        )}
      </CardContent>
    </Card>
  );
}
