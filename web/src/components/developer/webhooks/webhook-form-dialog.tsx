'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { EventPicker } from '@/components/developer/webhooks/event-picker';
import { createWebhook, updateWebhook, type DeveloperWebhook, type WebhookWithSecret } from '@/lib/developer';
import { ApiError } from '@/lib/api';

type Mode = 'create' | 'edit';

/**
 * نموذج إنشاء/تعديل اشتراك Webhook. **التحقّق النهائي للخادم** (§16): SSRF على العنوان
 * والكتالوج على الأحداث يعودان ٤٢٢ بنصّ يُعرَض للمستخدم كما هو. الأحداث من الكتالوج فقط.
 */
export function WebhookFormDialog({
  open,
  mode,
  webhook,
  onClose,
  onCreated,
  onUpdated,
}: {
  open: boolean;
  mode: Mode;
  webhook?: DeveloperWebhook;
  onClose: () => void;
  onCreated: (result: WebhookWithSecret) => void;
  onUpdated: () => void;
}) {
  const t = useTranslations('developer.webhooks');
  const tc = useTranslations('developer.common');
  const [url, setUrl] = useState(webhook?.url ?? '');
  const [events, setEvents] = useState<string[]>(webhook?.event_types ?? []);
  const [description, setDescription] = useState(webhook?.description ?? '');
  const [enabled, setEnabled] = useState((webhook?.status ?? 'enabled') === 'enabled');
  const [errors, setErrors] = useState<{ url?: string; events?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    if (url.trim() === '') next.url = t('urlHint');
    if (events.length === 0) next.events = t('eventsRequired');
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      if (mode === 'create') {
        const result = await createWebhook({ url: url.trim(), event_types: events, description: description.trim() || null });
        onCreated(result);
      } else if (webhook) {
        await updateWebhook(webhook.id, {
          url: url.trim(),
          event_types: events,
          description: description.trim() || null,
          status: enabled ? 'enabled' : 'disabled',
        });
        onUpdated();
      }
    } catch (error) {
      // رسالة الخادم (SSRF/كتالوج/حدّ) تُعرَض حرفياً على حقل العنوان أو النموذج.
      const message = error instanceof ApiError
        ? String((error.body as { message?: string })?.message || error.message)
        : (mode === 'create' ? t('createError') : t('updateError'));
      setErrors({ form: message });
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={mode === 'create' ? t('createTitle') : t('editTitle')} className="max-w-xl">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="dev-wh-url">{t('urlLabel')}</Label>
          <Input
            id="dev-wh-url"
            dir="ltr"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder={t('urlPlaceholder')}
            aria-invalid={Boolean(errors.url)}
            className="font-mono text-sm"
            maxLength={2048}
          />
          <p className="text-xs text-muted">{t('urlHint')}</p>
          {errors.url ? <p className="text-xs text-negative" role="alert">{errors.url}</p> : null}
        </div>

        <div className="space-y-1.5">
          <Label>{t('eventsLabel')}</Label>
          <p className="text-xs text-muted">{t('eventsHint')}</p>
          <EventPicker value={events} onChange={setEvents} error={errors.events} disabled={busy} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="dev-wh-desc">{t('descriptionLabel')}</Label>
          <Input
            id="dev-wh-desc"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t('descriptionPlaceholder')}
            maxLength={255}
          />
        </div>

        {mode === 'edit' ? (
          <div className="flex items-center justify-between rounded border border-border px-3 py-2.5">
            <Label htmlFor="dev-wh-status">{t('statusLabel')}</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">{enabled ? t('enabled') : t('disabled')}</span>
              <Switch checked={enabled} onCheckedChange={setEnabled} aria-label={t('statusLabel')} />
            </div>
          </div>
        ) : null}

        {errors.form ? <p className="rounded border border-negative/40 bg-negative/10 px-3 py-2 text-sm text-negative" role="alert">{errors.form}</p> : null}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>{tc('cancel')}</Button>
          <Button type="submit" disabled={busy}>{busy ? tc('saving') : (mode === 'create' ? tc('create') : tc('save'))}</Button>
        </div>
      </form>
    </Dialog>
  );
}
