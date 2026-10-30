'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { FormAlert } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { commonMessages } from '../../messages/common';
import { createPriceList, updatePriceList, type PriceList } from './api';
import { priceListsMessages } from './messages';

/** Create (no `list`) or edit one price list. Server messages (e.g. duplicate name) are shown inside the dialog. */
export function ListFormDialog({ list, onClose, onSaved }: { list: PriceList | null; onClose: () => void; onSaved: (saved: PriceList) => void }) {
  const locale = useLocale();
  const { t } = priceListsMessages.forLocale(locale);
  const common = commonMessages.forLocale(locale);
  const [name, setName] = useState(list?.name ?? '');
  const [description, setDescription] = useState(list?.description ?? '');
  const [active, setActive] = useState(list?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (name.trim() === '') {
      setError(t('nameRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    const input = { name: name.trim(), description: description.trim() === '' ? null : description.trim(), is_active: active };
    try {
      const saved = list ? await updatePriceList(list.id, input) : await createPriceList(input);
      onSaved(saved);
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : t('saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={busy ? () => undefined : onClose} title={list ? t('formEdit') : t('formCreate')}>
      <form onSubmit={(event) => void submit(event)} className="space-y-3" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="pl-name">{t('fieldName')}</Label>
          <Input id="pl-name" value={name} maxLength={255} required onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pl-desc">{t('fieldDescription')}</Label>
          <Textarea id="pl-desc" value={description} maxLength={2000} onChange={(event) => setDescription(event.target.value)} />
        </div>
        <div className="flex min-h-11 items-center justify-between gap-3">
          <Label htmlFor="pl-active">{t('fieldActive')}</Label>
          <Switch id="pl-active" checked={active} onCheckedChange={setActive} />
        </div>
        {error ? <FormAlert tone="error">{error}</FormAlert> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className="min-h-11" onClick={onClose} disabled={busy}>
            {common.t('cancel')}
          </Button>
          <Button type="submit" className="min-h-11" disabled={busy}>
            {busy ? common.t('saving') : common.t('save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
