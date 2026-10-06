'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { applyStarters, previewStarters, type StarterPreview } from '@/modules/commerce-workspace/vertical-setup';
import { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';

type MessageKey = Parameters<typeof commerceWorkspaceMessage>[1];

const FACET_LABEL: Record<string, MessageKey> = { occasion: 'storeCapOccasions', recipient: 'storeCapRecipients' };

/**
 * القيم المبدئية للمناسبات والمُهدى إليهم (ADR-25) — معاينة أولاً ثم تأكيد؛ تُضاف الناقصة فقط ولا يتغيّر شيء قائم.
 * يعيد استعمال دوال العميل نفسها لقائمة الإعداد القديمة (لا مسار كتابة موازٍ)، و`onApplied` يُعيد قراءة الحالة.
 */
export function StartersBox({ storeId, locale, onApplied }: { storeId: string; locale: string | undefined; onApplied: () => void }) {
  const t = useMemo(() => (key: MessageKey) => commerceWorkspaceMessage(locale, key), [locale]);
  const [preview, setPreview] = useState<StarterPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function onPreview() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const result = await previewStarters(storeId);
    setBusy(false);
    if (!result.ok) setNotice({ tone: 'error', text: t('storeSetupStartersFailed') });
    else setPreview(result.data);
  }

  async function onApply() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const result = await applyStarters(storeId);
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: 'error', text: t('storeSetupStartersFailed') });
      return;
    }
    setPreview(null);
    setNotice({ tone: 'ok', text: result.data.created > 0 ? `${t('storeSetupStartersDone')} (${result.data.created})` : t('storeSetupStartersNothingNew') });
    onApplied();
  }

  const blocked = preview?.facets.some((facet) => facet.facet === 'blocked') ?? false;

  return (
    <div className="space-y-2 rounded border border-dashed border-border p-3" data-starters-box>
      <p className="text-xs font-medium text-text">{t('storeSetupStartersTitle')}</p>
      <p className="text-xs leading-5 text-muted">{t('storeSetupStartersHint')}</p>
      {preview ? (
        <div className="space-y-2" data-starter-preview>
          {preview.wouldCreate === 0 ? (
            <p className="text-xs text-text">{t('storeSetupStartersNothingNew')}</p>
          ) : (
            <ul className="space-y-0.5 text-xs text-text">
              {preview.facets
                .filter((facet) => facet.facet !== 'blocked' && FACET_LABEL[facet.systemKey])
                .map((facet) => (
                  <li key={facet.systemKey}>
                    {t(FACET_LABEL[facet.systemKey])}: +{facet.missingCount}
                    {facet.existingCount > 0 ? ` (${facet.existingCount} ${t('storeSetupStartersAlready')})` : ''}
                  </li>
                ))}
            </ul>
          )}
          {blocked ? <p className="text-xs text-muted">{t('storeSetupStartersBlocked')}</p> : null}
          <div className="flex flex-wrap gap-2">
            {preview.wouldCreate > 0 ? (
              <Button type="button" size="sm" onClick={() => void onApply()} disabled={busy}>
                {busy ? t('storeSetupStartersApplying') : `${t('storeSetupStartersApply')} (${preview.wouldCreate})`}
              </Button>
            ) : null}
            <Button type="button" size="sm" variant="outline" onClick={() => setPreview(null)} disabled={busy}>
              {t('storeSettingsCancel')}
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={() => void onPreview()} disabled={busy}>
          {t('storeSetupStartersPreview')}
        </Button>
      )}
      {notice ? (
        <p role="status" className={notice.tone === 'ok' ? 'text-xs text-positive' : 'text-xs text-negative'}>
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}
