'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/**
 * FS-31: الخادم يقسّم القوائم على 50 صفاً والواجهة كانت تقرأ الصفحة الأولى وحدها بصمت؛
 * فالملخصات المحسوبة من القائمة تبدو إجماليات وهي ليست كذلك. الإشعار يظهر فقط حين
 * يزيد الإجمالي عن المحمَّل، ويتيح تحميل الصفحة التالية.
 */
export type PageMeta = { total?: number; current_page?: number; last_page?: number } | undefined;

export function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const seen = new Set(current.map((row) => row.id));
  return [...current, ...incoming.filter((row) => !seen.has(row.id))];
}

export function TruncationNotice({ loaded, meta, loading, onLoadMore, onRefresh }: { loaded: number; meta: PageMeta; loading?: boolean; onLoadMore: () => void; onRefresh: () => void }) {
  const tc = useTranslations('common');
  const total = meta?.total;
  if (typeof total !== 'number' || total <= loaded) return null;
  // ترقيم بالإزاحة: إدراج سجل بين طلبين يكرّر صفاً في الصفحة التالية، فيبقى المحمَّل أقل من الإجمالي
  // وقد بلغنا آخر صفحة؛ عندها لا صفحات أخرى لطلبها ويُعرض «تحديث» لإعادة المطابقة بدل زرٍّ يطلب صفحات فارغة.
  const hasMorePages = typeof meta?.last_page !== 'number' || (meta?.current_page ?? 1) < meta.last_page;
  return (
    <div role="status" className="flex flex-col gap-2 rounded-md border border-border bg-warning/10 px-3 py-2 text-sm text-text sm:flex-row sm:items-center sm:justify-between">
      <p>{tc('listTruncated', { loaded, total })}</p>
      {hasMorePages
        ? <Button type="button" variant="outline" disabled={loading} onClick={onLoadMore}>{tc('loadMore')}</Button>
        : <Button type="button" variant="outline" disabled={loading} onClick={onRefresh}>{tc('refresh')}</Button>}
    </div>
  );
}
