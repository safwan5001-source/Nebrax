'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, FileText, ClipboardCheck, Package, PencilLine } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

type Action = 'created' | 'updated' | 'status';
type DocType = 'invoice' | 'quote' | 'procurement' | 'stocktake' | 'stock_permit';

interface Revision {
  id: string;
  action: Action;
  document_type: DocType | null;
  document_number: string | null;
  user_name: string | null;
  created_at: string;
}

const ICON: Record<DocType, typeof FileText> = {
  invoice: FileText,
  quote: ClipboardCheck,
  procurement: ClipboardCheck,
  stocktake: Package,
  stock_permit: Package,
};

/**
 * سجلّ النشاطات — مبنيّ على `document_revisions` القائم لا على جدول جديد.
 *
 * السجلّ يخزّن **فروق حقول** لا جملاً؛ فالجملة تُركَّب هنا في طبقة العرض من
 * (الفعل + نوع المستند + رقمه + الفاعل). هذا يبقي التخزين محايداً ويجعل
 * الصياغة قابلة للترجمة — بدل نصٍّ عربي مطبوع في قاعدة البيانات.
 */
export function ActivityFeed({ limit = 6 }: { limit?: number }) {
  const t = useTranslations('dashboard');
  const [rows, setRows] = useState<Revision[] | null>(null);

  useEffect(() => {
    import('@/lib/api')
      .then(({ api }) => api<{ data: Revision[] }>(`/revisions?limit=${limit}`))
      .then((r) => setRows(r.data))
      .catch(() => setRows([]));
  }, [limit]);

  if (rows === null) return <Skeleton className="h-40 w-full" />;
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-muted">{t('activity_empty')}</p>;

  return (
    <ul className="flex flex-col">
      {rows.map((r) => {
        const Icon = r.action === 'status' ? CheckCircle2 : r.document_type ? ICON[r.document_type] : PencilLine;
        const docLabel = r.document_type ? t(`doc_${r.document_type}`) : '';

        return (
          <li key={r.id} className="flex items-start gap-3 border-b border-border py-3 last:border-0 last:pb-1">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-background">
              <Icon className="h-[15px] w-[15px] text-muted" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium leading-snug text-text">
                {t(`act_${r.action}`, { doc: docLabel })}{' '}
                {r.document_number && <span className="num font-bold">{r.document_number}</span>}
                {r.user_name && <span className="text-muted"> — {r.user_name}</span>}
              </p>
              <p className="num mt-0.5 text-[11.5px] text-muted">
                {new Date(r.created_at).toLocaleString('ar-SA')}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
