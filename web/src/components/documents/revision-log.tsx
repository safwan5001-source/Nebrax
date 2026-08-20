'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

type Action = 'created' | 'updated' | 'status';

interface Revision {
  id: string;
  action: Action;
  changes: Record<string, [unknown, unknown]>;
  user_name: string | null;
  created_at: string;
}

/** حقول تُعرض بالريال — القيم تصل بالهللات كما تُخزَّن. */
const MONEY = new Set([
  'subtotal', 'discount', 'shipping', 'adjustment', 'tax_amount', 'total', 'paid_amount',
]);

/** حقول داخلية لا تعني المستخدم شيئاً. */
const HIDDEN = new Set(['journal_entry_id', 'cogs_entry_id', 'zatca_icv', 'zatca_hash']);

const tone: Record<Action, 'positive' | 'muted' | 'negative'> = {
  created: 'positive',
  status: 'positive',
  updated: 'muted',
};

function display(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (MONEY.has(field)) return formatRiyal(Number(value) / 100);
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  return String(value);
}

/**
 * سجلّ تغييرات مستند — خطٌّ زمني للقراءة فقط.
 *
 * وجودُه هو الغرض: ثلاثة أعطال كانت تغيّر مبالغ الفواتير صامتةً ولم يكشفها
 * إلا مسحٌ متعمَّد للكود. هذه الشاشة تجعل مثلها مرئياً وقت حدوثه.
 */
export function RevisionLog({
  type,
  id,
  collapsible = false,
  defaultOpen = true,
}: {
  type: 'invoice' | 'quote' | 'procurement';
  id: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const t = useTranslations('revisions');
  const [log, setLog] = useState<Revision[] | null>(null);
  const [open, setOpen] = useState(defaultOpen);
  const contentId = `revision-log-${type}-${id}`;

  useEffect(() => {
    api<{ data: Revision[] }>(`/revisions/${type}/${id}`)
      .then((r) => setLog(r.data))
      .catch(() => setLog([]));
  }, [type, id]);

  return (
    <Card className="no-print">
      <CardHeader className={collapsible ? 'p-0' : undefined}>
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={contentId}
            className="flex w-full items-center justify-between gap-3 px-5 py-4 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
          >
            <CardTitle>{t('title')}</CardTitle>
            <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180 text-primary' : ''}`} strokeWidth={2} />
          </button>
        ) : <CardTitle>{t('title')}</CardTitle>}
      </CardHeader>
      {(!collapsible || open) && <CardContent id={contentId}>
        {log === null ? (
          <Skeleton className="h-24 w-full" />
        ) : log.length === 0 ? (
          <p className="text-sm text-muted">{t('empty')}</p>
        ) : (
          <ol className="space-y-3">
            {log.map((entry) => {
              const fields = Object.entries(entry.changes).filter(([f]) => !HIDDEN.has(f));
              return (
                <li key={entry.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={tone[entry.action]}>{t(`action_${entry.action}`)}</Badge>
                    <span className="text-sm text-text">{entry.user_name ?? t('system')}</span>
                    <span className="num text-xs text-muted">
                      {new Date(entry.created_at).toLocaleString('ar-SA')}
                    </span>
                  </div>

                  {fields.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {fields.map(([field, [before, after]]) => (
                        <li key={field} className="flex flex-wrap items-baseline gap-1.5 text-xs">
                          <span className="text-muted">{t.has(`f_${field}`) ? t(`f_${field}`) : field}:</span>
                          <span className="num text-muted line-through">{display(field, before)}</span>
                          <span className="text-muted">←</span>
                          <span className="num text-text">{display(field, after)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>}
    </Card>
  );
}
