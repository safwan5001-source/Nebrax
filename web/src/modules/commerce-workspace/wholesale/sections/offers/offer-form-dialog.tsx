'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { FormAlert } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { WorkspaceProductSummary } from '@/modules/commerce-workspace/workspace-products';
import { commonMessages } from '../../messages/common';
import {
  createWorkspaceOffer,
  fromLocalInput,
  searchEligibleProducts,
  toLocalInput,
  updateWorkspaceOffer,
  type WorkspaceOffer,
} from './api';
import { offersMessages } from './messages';

/** Create (no `offer`: pick an eligible product) or edit (window + enabled only). Server messages stay visible. */
export function OfferFormDialog({
  storeId,
  offer,
  takenProductIds,
  onClose,
  onSaved,
}: {
  storeId: string;
  offer: WorkspaceOffer | null;
  takenProductIds: string[];
  onClose: () => void;
  onSaved: (saved: WorkspaceOffer, created: boolean) => void;
}) {
  const locale = useLocale();
  const { t } = offersMessages.forLocale(locale);
  const common = commonMessages.forLocale(locale);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WorkspaceProductSummary[] | null>(null);
  const [product, setProduct] = useState<WorkspaceProductSummary | null>(null);
  const [starts, setStarts] = useState(toLocalInput(offer?.startsAt ?? null));
  const [ends, setEnds] = useState(toLocalInput(offer?.endsAt ?? null));
  const [active, setActive] = useState(offer?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const term = query.trim();
    if (offer || product || term.length < 2) {
      setResults(null);
      return;
    }
    let live = true;
    const timer = window.setTimeout(() => {
      searchEligibleProducts(storeId, term).then((rows) => live && setResults(rows));
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query, product, offer, storeId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!offer && !product) {
      setError(t('productRequired'));
      return;
    }
    const startsAt = fromLocalInput(starts);
    const endsAt = fromLocalInput(ends);
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      setError(t('windowInvalid'));
      return;
    }
    setBusy(true);
    setError(null);
    const write = { startsAt, endsAt, isActive: active };
    const outcome = offer
      ? await updateWorkspaceOffer(storeId, offer.id, write)
      : await createWorkspaceOffer(storeId, { ...write, productId: product!.id });
    setBusy(false);
    if (outcome.ok) {
      onSaved(outcome.data, !offer);
      return;
    }
    const field = Object.values(outcome.fieldErrors)[0];
    setError(outcome.reason === 'conflict' ? t('conflict') : (field ?? (outcome.reason === 'validation' && outcome.message ? outcome.message : t('saveFailed'))));
  }

  const choices = (results ?? []).filter((row) => !takenProductIds.includes(row.id));

  return (
    <Dialog open onClose={busy ? () => undefined : onClose} title={offer ? t('formEdit') : t('formCreate')}>
      <form onSubmit={(event) => void submit(event)} className="space-y-3" noValidate>
        {offer ? (
          <p className="text-sm font-medium text-text"><bdi>{offer.product?.name ?? t('deletedProduct')}</bdi></p>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="offer-product">{t('productSearch')}</Label>
            <Input
              id="offer-product"
              type="search"
              autoComplete="off"
              value={product ? product.name : query}
              placeholder={t('productSearchHint')}
              onChange={(event) => {
                setProduct(null);
                setQuery(event.target.value);
              }}
            />
            {results !== null && !product ? (
              choices.length === 0 ? (
                <p className="text-xs text-muted">{t('productNone')}</p>
              ) : (
                <ul role="listbox" aria-label={t('productSearch')} className="max-h-44 divide-y divide-border overflow-y-auto rounded border border-border">
                  {choices.map((row) => (
                    <li key={row.id} role="option" aria-selected={false}>
                      <button type="button" className="flex min-h-11 w-full items-center px-2.5 text-start text-sm hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40" onClick={() => setProduct(row)}>
                        <bdi className="truncate">{row.name}</bdi>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="offer-starts">{t('fieldStarts')}</Label>
            <Input id="offer-starts" type="datetime-local" value={starts} onChange={(event) => setStarts(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="offer-ends">{t('fieldEnds')}</Label>
            <Input id="offer-ends" type="datetime-local" value={ends} onChange={(event) => setEnds(event.target.value)} />
          </div>
        </div>
        <p className="text-xs text-muted">{t('windowHint')}</p>
        <div className="flex min-h-11 items-center justify-between gap-3">
          <Label htmlFor="offer-active">{t('fieldActive')}</Label>
          <Switch id="offer-active" checked={active} onCheckedChange={setActive} />
        </div>
        {error ? <FormAlert tone="error">{error}</FormAlert> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className="min-h-11" onClick={onClose} disabled={busy}>{common.t('cancel')}</Button>
          <Button type="submit" className="min-h-11" disabled={busy}>{busy ? common.t('saving') : common.t('save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
