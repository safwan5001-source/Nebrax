'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';
import {
  SETUP_DESTINATIONS,
  applyStarters,
  loadVerticalSetup,
  previewStarters,
  type StarterPreview,
  type VerticalSetup,
} from '@/modules/commerce-workspace/vertical-setup';

type MessageKey = Parameters<typeof commerceWorkspaceMessage>[1];

/** مفتاح قدرة من الخادم → نص الواجهة. مفتاحٌ غير معروف يُخفى بدل عرض معرّف خام. */
const CAPABILITY_LABEL: Record<string, MessageKey> = {
  occasions: 'storeCapOccasions',
  recipients: 'storeCapRecipients',
  gift_message: 'storeCapGiftMessage',
  personalization: 'storeCapPersonalization',
  add_ons: 'storeCapAddOns',
  delivery_scheduling: 'storeCapDeliveryScheduling',
  same_day_delivery: 'storeCapSameDayDelivery',
  structured_content: 'storeCapStructuredContent',
  vertical_sections: 'storeCapVerticalSections',
};

const FACET_LABEL: Record<string, MessageKey> = {
  occasion: 'storeCapOccasions',
  recipient: 'storeCapRecipients',
};

type Phase =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; setup: VerticalSetup };

/**
 * FLOWERS-H14 / ADR-25 — «إعداد نشاط الهدايا»: ما هُيِّئ فعلاً وما بقي، مع إضافة القيم المبدئية.
 *
 * - الحالة من الخادم (مشتقّة من الإعداد الحقيقي)، لا علَم محلي.
 * - القيم المبدئية تمرّ بمعاينة صريحة ثم تأكيد؛ تُضاف الناقصة فقط ولا يتغيّر شيء قائم.
 * - لا تفعيل لأي سياسة (إهداء/جدولة…): تلك قرار التاجر؛ تظهر هنا حالتها فقط، وحين لا توجد شاشة لضبطها
 *   بعد يُقال ذلك صراحةً بدل رابطٍ ميّت.
 */
export function VerticalSetupPanel({ storeId, locale }: { storeId: string; locale: string | undefined }) {
  const t = (key: MessageKey) => commerceWorkspaceMessage(locale, key);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [preview, setPreview] = useState<StarterPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const reload = useCallback(async () => {
    const setup = await loadVerticalSetup(storeId);
    setPhase(setup && setup.items.length > 0 ? { kind: 'ready', setup } : { kind: 'error' });
  }, [storeId]);

  useEffect(() => {
    let cancelled = false;
    void loadVerticalSetup(storeId).then((setup) => {
      if (cancelled) return;
      setPhase(setup && setup.items.length > 0 ? { kind: 'ready', setup } : { kind: 'error' });
    });
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  async function onPreview() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const result = await previewStarters(storeId);
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: 'error', text: t('storeSetupStartersFailed') });
      return;
    }
    setPreview(result.data);
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
    setNotice({
      tone: 'ok',
      text: result.data.created > 0
        ? `${t('storeSetupStartersDone')} (${result.data.created})`
        : t('storeSetupStartersNothingNew'),
    });
    await reload();
  }

  if (phase.kind === 'loading') {
    return <p className="text-xs text-muted">{t('storeSetupLoading')}</p>;
  }
  if (phase.kind === 'error') {
    return <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{t('storeSetupLoadFailed')}</p>;
  }

  const items = phase.setup.items.filter((item) => CAPABILITY_LABEL[item.key]);
  const configured = items.filter((item) => item.state === 'configured').length;
  const blocked = preview?.facets.filter((facet) => facet.facet === 'blocked') ?? [];

  return (
    <section aria-label={t('storeSetupTitle')} className="space-y-3" data-vertical-setup>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium text-text">{t('storeSetupTitle')}</h3>
        <span className="text-xs text-muted" data-setup-progress>
          {configured} / {items.length} {t('storeSetupConfigured')}
        </span>
      </div>
      <p className="text-xs text-muted">{t('storeSetupHint')}</p>

      <ul className="divide-y divide-border rounded border border-border">
        {items.map((item) => {
          const destination = SETUP_DESTINATIONS[item.manageIn] ?? null;
          const done = item.state === 'configured';
          return (
            <li key={item.key} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs" data-setup-item={item.key}>
              <span className="min-w-0 text-text">{t(CAPABILITY_LABEL[item.key])}</span>
              <span className="flex shrink-0 items-center gap-3">
                <span className={done ? 'font-medium text-positive' : 'text-muted'}>
                  {done ? t('storeSetupDone') : t('storeSetupTodo')}
                </span>
                {destination ? (
                  <Link href={destination} className="text-accent hover:underline">
                    {t('storeSetupManage')}
                  </Link>
                ) : (
                  <span className="text-muted" title={t('storeSetupNoScreenHint')}>
                    {t('storeSetupNoScreen')}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="space-y-2 rounded border border-border p-3">
        <h4 className="text-xs font-medium text-text">{t('storeSetupStartersTitle')}</h4>
        <p className="text-xs text-muted">{t('storeSetupStartersHint')}</p>

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
            {blocked.length > 0 ? (
              <p className="text-xs text-muted">{t('storeSetupStartersBlocked')}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {preview.wouldCreate > 0 ? (
                <Button type="button" size="sm" onClick={onApply} disabled={busy}>
                  {busy ? t('storeSetupStartersApplying') : `${t('storeSetupStartersApply')} (${preview.wouldCreate})`}
                </Button>
              ) : null}
              <Button type="button" size="sm" variant="outline" onClick={() => setPreview(null)} disabled={busy}>
                {t('storeSettingsCancel')}
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={onPreview} disabled={busy}>
            {t('storeSetupStartersPreview')}
          </Button>
        )}

        {notice ? (
          <p
            role="status"
            className={notice.tone === 'ok' ? 'text-xs text-positive' : 'rounded bg-negative/10 px-3 py-2 text-xs text-negative'}
          >
            {notice.text}
          </p>
        ) : null}
      </div>
    </section>
  );
}
