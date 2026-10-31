'use client';

import * as React from 'react';
import { Home, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** صفحات مقترحة (لا شاشة لها في تطبيق الجوال الحالي) — تُعرض بسببها ولا تُضاف أبداً. */
export const EASY_PROPOSED_PAGES = ['categories', 'account', 'orders'] as const;

/**
 * إدارة الصفحة المحددة في الوضع السهل (مواصفة V2 §4.4): تعيينها رئيسية، وحذفها بعد تأكيد يُعلن عدد الإجراءات التي تتنقّل إليها
 * (تبقى مخالفة حاجبة حتى تُصلَح). الرئيسية لا تُحذف ولا يُعاد تعيينها. الصفحات المقترحة معطّلة بسببها.
 */
export function EasyPageActions({
  pageId, pageName, isInitial, canDelete, canManage, navigationRefs, onSetHome, onDelete, t,
}: {
  pageId: string;
  pageName: string;
  isInitial: boolean;
  canDelete: boolean;
  canManage: boolean;
  navigationRefs: number;
  onSetHome: () => void;
  onDelete: () => void;
  t: Translate;
}) {
  const [confirming, setConfirming] = React.useState(false);
  return (
    <div className="shrink-0 space-y-1 border-b border-border px-3 py-1.5" data-testid="easy-page-actions" data-page={pageId}>
      {isInitial ? (
        <p className="text-[11px] text-muted">{t('easy.pageActions.homeNote')}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" disabled={!canManage} onClick={onSetHome}>
            <Home className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
            {t('easy.pageActions.setHome')}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 text-xs text-negative" disabled={!canManage || !canDelete} onClick={() => setConfirming(true)}>
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
            {t('easy.pageActions.delete')}
          </Button>
        </div>
      )}
      <details className="text-[11px]">
        <summary className="cursor-pointer text-muted">{t('easy.pageActions.proposedTitle')}</summary>
        <ul className="mt-1 space-y-1">
          {EASY_PROPOSED_PAGES.map((key) => (
            <li key={key} className="rounded border border-dashed border-border px-2 py-1">
              <span className="font-medium text-text">{t(`easy.pageActions.proposed.${key}`)}</span>
              <span className="block text-muted">{t('easy.pageActions.proposedReason')}</span>
            </li>
          ))}
        </ul>
      </details>
      <Dialog open={confirming} onClose={() => setConfirming(false)} title={t('easy.pageActions.deleteTitle', { name: pageName })}>
        <div className="space-y-3">
          <p className="text-sm text-text">{t('easy.pageActions.deleteBody', { count: navigationRefs })}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirming(false)}>{t('easy.pageActions.cancel')}</Button>
            <Button type="button" variant="danger" onClick={() => { setConfirming(false); onDelete(); }}>{t('easy.pageActions.deleteConfirm')}</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
