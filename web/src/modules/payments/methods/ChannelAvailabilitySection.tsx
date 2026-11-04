'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/lib/use-can';
import { choiceOf, fetchChannelAvailability, saveChannelAvailability, type AvailabilityChoice, type ChannelAvailabilityRow } from './channel-availability';

/**
 * COPS-H4-6 (D-H4-06) — «الإتاحة حسب القناة» داخل شاشة الوسيلة القائمة (`/payment-methods`). مصدر الحقيقة الوحيد للإتاحة هو الخادم (`PaymentMethodChannelAvailabilityService`
 * الذي يقرؤه Checkout المتجر)؛ هنا عرض وتغيير فقط. تظهر **فقط** لمن يملك الصلاحيتين (`payments.manage` + `commerce.channel_settings.manage`) — وإلا لا شيء يُعرض ولا طلب يُرسَل.
 * كل تغيير يُحفظ فوراً لقناته ويُحدَّث صفها بما يعيده الخادم (النتيجة الفعلية)؛ قفل لكل قناة أثناء الطلب.
 */
export function ChannelAvailabilitySection({ methodId, methodActive }: { methodId: string; methodActive: boolean }) {
  const t = useTranslations('paymentMethods.channels');
  const { success, error: toastError } = useToast();
  const { can, hydrated } = useCan();
  const allowed = hydrated && can('payments.manage') && can('commerce.channel_settings.manage');

  const [rows, setRows] = useState<ChannelAvailabilityRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const inFlight = useRef(new Set<string>());

  const load = useCallback(() => {
    setFailed(false);
    fetchChannelAvailability(methodId).then((view) => setRows(view.channels), () => setFailed(true));
  }, [methodId]);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  if (!allowed) return null;

  async function change(row: ChannelAvailabilityRow, choice: AvailabilityChoice) {
    if (inFlight.current.has(row.channelId) || choice === choiceOf(row.override)) return;
    inFlight.current.add(row.channelId);
    setBusy(row.channelId);
    try {
      const saved = await saveChannelAvailability(methodId, row.channelId, choice);
      setRows((current) => (current ?? []).map((r) => (r.channelId === saved.channelId ? saved : r)));
      success(t('saved'));
    } catch {
      toastError(t('saveFailed'));
      load();
    } finally {
      inFlight.current.delete(row.channelId);
      setBusy(null);
    }
  }

  return (
    <fieldset className="space-y-2 rounded-md border border-border p-3" data-testid="payment-method-channels">
      <legend className="px-1 text-xs font-medium text-muted">{t('title')}</legend>
      <p className="text-xs text-muted">{t('hint')}</p>
      {!methodActive && <p className="text-xs text-warning">{t('methodInactive')}</p>}
      {failed ? (
        <p role="alert" className="text-xs text-negative">{t('loadFailed')}</p>
      ) : rows === null ? (
        <p role="status" className="text-xs text-muted">{t('loading')}</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted">{t('empty')}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.channelId} className="flex flex-wrap items-center justify-between gap-2" data-testid={`channel-row-${row.channelId}`}>
              <div className="min-w-0">
                <p className="truncate text-sm text-text">{row.name}</p>
                <p className="text-xs text-muted">
                  {t(row.type === 'mobile' ? 'type.mobile' : 'type.web')}
                  {!row.isActive ? ` · ${t('channelInactive')}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={row.effective ? 'positive' : 'muted'}>{t(row.effective ? 'effective.on' : 'effective.off')}</Badge>
                <Select
                  aria-label={`${t('choiceLabel')} — ${row.name}`}
                  value={choiceOf(row.override)}
                  disabled={busy === row.channelId}
                  onChange={(event) => void change(row, event.target.value as AvailabilityChoice)}
                  className="w-44"
                >
                  <option value="default">{t('choice.default')}</option>
                  <option value="enabled">{t('choice.enabled')}</option>
                  <option value="disabled">{t('choice.disabled')}</option>
                </Select>
              </div>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
