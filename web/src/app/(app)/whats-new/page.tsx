'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { PageHeader } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/formatting';
import { type SystemUpdate, fetchSystemUpdates } from '@/lib/system-updates';

export default function WhatsNewPage() {
  const t = useTranslations('whatsNew');
  const locale = useLocale();

  const [items, setItems] = useState<SystemUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const res = await fetchSystemUpdates();
      setItems(res.data);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const title = (item: SystemUpdate) => (locale === 'ar' ? item.title_ar : item.title_en);
  const content = (item: SystemUpdate) => (locale === 'ar' ? item.content_ar : item.content_en);

  return (
    <div className="space-y-6">
      <PageHeader title={t('pageTitle')} description={t('pageSubtitle')} />

      {loadFailed && !loading ? (
        <div className="rounded border border-negative/30 bg-negative/10 p-4">
          <p className="text-sm text-text">{t('loadFailed')}</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={load}>
            {t('retry')}
          </Button>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded border border-border bg-surface p-8 text-center">
          <p className="text-sm text-muted">{t('empty')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <article
              key={item.id}
              className="rounded-lg border border-border bg-surface p-5 space-y-2"
            >
              <h2 className="text-base font-semibold text-text">{title(item)}</h2>
              {item.published_at && (
                <p className="num text-xs text-muted">
                  {t('publishedAt', { date: formatDate(item.published_at, locale) })}
                </p>
              )}
              <div className="prose prose-sm max-w-none text-text whitespace-pre-line">
                {content(item)}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
