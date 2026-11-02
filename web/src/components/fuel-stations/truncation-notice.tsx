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

export function TruncationNotice({ loaded, total, loading, onLoadMore }: { loaded: number; total?: number; loading?: boolean; onLoadMore: () => void }) {
  const tc = useTranslations('common');
  if (typeof total !== 'number' || total <= loaded) return null;
  return (
    <div role="status" className="flex flex-col gap-2 rounded-md border border-border bg-warning/10 px-3 py-2 text-sm text-text sm:flex-row sm:items-center sm:justify-between">
      <p>{tc('listTruncated', { loaded, total })}</p>
      <Button type="button" variant="outline" disabled={loading} onClick={onLoadMore}>{tc('loadMore')}</Button>
    </div>
  );
}
