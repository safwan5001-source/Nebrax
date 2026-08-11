'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Lock, LockOpen, ShoppingCart } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { cn } from '@/lib/utils';

interface PosSession {
  id: string;
  number: string;
  status: 'open' | 'closed';
  opening_balance: string;
  closing_balance: string | null;
  opened_at: string | null;
}

/**
 * صناديق البيع.
 *
 * **ما يعرضه فعلاً: ورديات نقطة البيع (`pos_sessions`).** لا يوجد في النظام
 * كيان «صندوق» له اسم ثابت ورصيد حيّ — الوردية سجلٌّ تشغيلي يُفتح برصيد
 * ويُغلق بآخر. فتُعرض بأرقامها الحقيقية بدل أسماء مُخترَعة، ويُقال ذلك في
 * التلميح بدل أن يبدو النقص ميزةً.
 */
export function Registers() {
  const t = useTranslations('dashboard');
  const [rows, setRows] = useState<PosSession[] | null>(null);

  useEffect(() => {
    api<{ data: PosSession[] }>('/pos-sessions')
      .then((r) => setRows(r.data.slice(0, 4)))
      .catch(() => setRows([]));
  }, []);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <ShoppingCart className="h-[18px] w-[18px] text-text" strokeWidth={2} />
          <h2 className="text-[14.5px] font-semibold text-text">{t('registers')}</h2>
        </div>
        <Link href="/pos/sessions" className="text-[13px] font-semibold text-primary hover:underline">
          {t('registers_manage')} ←
        </Link>
      </div>

      {rows === null ? (
        <Skeleton className="h-24 w-full" />
      ) : rows.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="p-5 text-sm text-muted">{t('registers_empty')}</CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          {rows.map((s) => {
            const open = s.status === 'open';
            const Icon = open ? LockOpen : Lock;

            return (
              <Card key={s.id} className="rounded-2xl">
                <CardContent className="p-4">
                  <div className="mb-3.5 flex items-center justify-between gap-2">
                    <span className="num truncate text-sm font-bold text-text">{s.number}</span>
                    <Badge tone={open ? 'positive' : 'muted'}>{t(open ? 'reg_open' : 'reg_closed')}</Badge>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]',
                        open ? 'bg-positive/10' : 'bg-background'
                      )}
                    >
                      <Icon
                        className={cn('h-[17px] w-[17px]', open ? 'text-positive' : 'text-muted')}
                        strokeWidth={2}
                      />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11.5px] text-muted">
                        {t(open ? 'reg_opening_balance' : 'reg_closing_balance')}
                      </p>
                      <p className="num text-[15px] font-bold text-text">
                        {formatRiyal(open ? s.opening_balance : (s.closing_balance ?? '0'))}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* لا يُخفى أن المعروض ورديات لا صناديق مسمّاة. */}
      <p className="mt-2 text-[11.5px] text-muted">{t('registers_note')}</p>
    </section>
  );
}
