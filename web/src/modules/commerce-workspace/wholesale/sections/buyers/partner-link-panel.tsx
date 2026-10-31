'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { formatDateTime } from '@/lib/formatting';
import { classifyError, errorReason, useResource } from '../../use-resource';
import {
  fetchPartnerLink,
  linkPartner,
  searchEligiblePartners,
  unlinkPartner,
  type EligiblePartner,
  type PartnerLinkRow,
  type PartnerLinkState,
  type PriceListRef,
} from './api';
import { buyersMessages, type BuyersMessageKey } from './messages';

const SEARCH_DEBOUNCE_MS = 300;

/** Friendly key for a rejected link/unlink: the server `reason` first, then the HTTP class. */
export function linkErrorKey(error: unknown): BuyersMessageKey {
  const reason = errorReason(error);
  const known = ['membership_not_approved', 'partner_not_eligible', 'partner_not_found', 'already_linked', 'identity_not_eligible', 'not_linked', 'not_found'];
  if (reason && known.includes(reason)) return `linkError.${reason}` as BuyersMessageKey;
  const kind = classifyError(error);
  if (kind === 'forbidden') return 'linkError.forbidden';
  if (kind === 'network') return 'linkError.network';
  return 'linkError.unknown';
}

/**
 * Staff partner linking for one membership: the effective price relationship, the active link, a search over eligible
 * customers, link/unlink, and the audit trail (who linked/unlinked and when). Buyers never reach this screen. The server
 * owns eligibility, permissions and tenant isolation; this component only sends a partner id.
 */
export function PartnerLinkPanel({ membershipId, approved, canLink }: { membershipId: string; approved: boolean; canLink: boolean }) {
  const locale = useLocale();
  const { t } = buyersMessages.forLocale(locale);
  const toast = useToast();
  const loaded = useResource(() => fetchPartnerLink(membershipId), [membershipId]);
  const [override, setOverride] = useState<PartnerLinkState | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<BuyersMessageKey | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  useEffect(() => {
    setOverride(null);
    setErrorKey(null);
    setConfirmUnlink(false);
  }, [membershipId]);

  const state: PartnerLinkState | null = override ?? (loaded.state.status === 'ready' ? loaded.state.data : null);

  async function run(action: () => Promise<PartnerLinkState>, doneKey: 'linkDone' | 'unlinkDone') {
    setBusy(true);
    setErrorKey(null);
    try {
      setOverride(await action());
      setConfirmUnlink(false);
      toast.success(t(doneKey));
    } catch (error) {
      const key = linkErrorKey(error);
      setErrorKey(key);
      toast.error(t(key));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="partner-link-title" className="space-y-3 border-t border-border p-4 text-sm">
      <div>
        <h3 id="partner-link-title" className="text-sm font-semibold text-text">{t('linkTitle')}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">{t('linkDescription')}</p>
      </div>

      {state === null && loaded.state.status === 'loading' ? <p className="text-xs text-muted" role="status">{t('linkLoading')}</p> : null}
      {state === null && loaded.state.status === 'error' ? (
        <div role="alert" className="space-y-2 rounded border border-negative/30 bg-negative/10 px-3 py-2 text-negative">
          <p>{t('linkLoadError')}</p>
          <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={loaded.reload}>{t('linkRetry')}</Button>
        </div>
      ) : null}

      {state ? (
        <>
          <EffectiveList state={state} />
          <ActiveLink state={state} />

          {!canLink ? <p className="text-xs text-muted">{t('linkNoPermission')}</p> : null}
          {canLink && !approved && state.active === null ? <p className="text-xs text-muted">{t('linkNeedsApproval')}</p> : null}

          {canLink && state.active !== null ? (
            confirmUnlink ? (
              <div className="space-y-2 rounded border border-border bg-surface p-3">
                <p>{t('unlinkConfirm')}</p>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => setConfirmUnlink(false)}>{t('linkRetry')}</Button>
                  <Button type="button" variant="danger" className="min-h-11" disabled={busy} onClick={() => void run(() => unlinkPartner(membershipId), 'unlinkDone')}>
                    {busy ? t('linking') : t('confirm')}
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => setConfirmUnlink(true)}>{t('unlinkAction')}</Button>
            )
          ) : null}

          {canLink && approved && state.active === null ? (
            <PartnerPicker busy={busy} onPick={(partner) => void run(() => linkPartner(membershipId, partner.id), 'linkDone')} />
          ) : null}

          {errorKey ? <p role="alert" className="rounded border border-negative/30 bg-negative/10 px-3 py-2 text-negative">{t(errorKey)}</p> : null}
          <History rows={state.history} />
        </>
      ) : null}
    </section>
  );
}

function ListName({ list }: { list: PriceListRef | null }) {
  const { t } = buyersMessages.forLocale(useLocale());
  if (!list) return <span className="text-muted">{t('noPriceList')}</span>;
  return (
    <span>
      <bdi>{list.name}</bdi>
      {list.is_active ? null : <span className="ms-1 text-xs text-muted">({t('inactiveList')})</span>}
    </span>
  );
}

function EffectiveList({ state }: { state: PartnerLinkState }) {
  const { t } = buyersMessages.forLocale(useLocale());
  const e = state.effective_price_list;

  return (
    <div className="rounded border border-border bg-surface p-3" data-testid="effective-price-list">
      <p className="text-xs font-medium text-muted">{t('effectiveTitle')}</p>
      <p className="mt-0.5 font-medium text-text">
        {t(`effective.${e.source}` as BuyersMessageKey)}
        {e.price_list ? <>{' · '}<ListName list={e.price_list} /></> : null}
      </p>
      <p className="mt-1 text-xs text-muted">{t('effectiveNote')}</p>
    </div>
  );
}

function ActiveLink({ state }: { state: PartnerLinkState }) {
  const locale = useLocale();
  const { t } = buyersMessages.forLocale(locale);
  const a = state.active;

  if (!a) return <p className="text-muted">{t('notLinked')}</p>;

  return (
    <div>
      <p className="text-xs font-medium text-muted">{t('linkedTo')}</p>
      <p className="font-medium text-text"><bdi>{a.partner?.name ?? '—'}</bdi>{a.partner?.code ? <span className="ms-2 text-xs text-muted" dir="ltr">{a.partner.code}</span> : null}</p>
      <p className="mt-0.5 text-xs text-muted">
        {t('linkedBy')} <bdi>{a.linked_by?.name ?? '—'}</bdi> · <span className="num">{formatDateTime(a.linked_at, locale)}</span>
      </p>
    </div>
  );
}

function History({ rows }: { rows: PartnerLinkRow[] }) {
  const locale = useLocale();
  const { t } = buyersMessages.forLocale(locale);

  return (
    <div>
      <p className="text-xs font-medium text-muted">{t('historyTitle')}</p>
      {rows.length === 0 ? (
        <p className="mt-1 text-xs text-muted">{t('historyEmpty')}</p>
      ) : (
        <ol className="mt-1 space-y-1.5 text-xs">
          {rows.map((row) => (
            <li key={row.id} className="rounded border border-border px-2 py-1.5">
              <bdi className="font-medium text-text">{row.partner?.name ?? '—'}</bdi>
              <div className="text-muted">
                {t('historyLinked')} · <span className="num">{formatDateTime(row.linked_at, locale)}</span> · {t('historyBy', { name: row.linked_by?.name ?? '—' })}
              </div>
              {row.revoked_at ? (
                <div className="text-muted">
                  {t('historyRevoked')} · <span className="num">{formatDateTime(row.revoked_at, locale)}</span> · {t('historyBy', { name: row.revoked_by?.name ?? '—' })}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Debounced search over eligible customers; picking one is the link action. */
function PartnerPicker({ busy, onPick }: { busy: boolean; onPick: (partner: EligiblePartner) => void }) {
  const locale = useLocale();
  const { t } = buyersMessages.forLocale(locale);
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setTerm(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [q]);
  const results = useResource(() => searchEligiblePartners(term), [term]);

  return (
    <div className="space-y-2">
      <div>
        <Label htmlFor="wholesale-partner-search">{t('partnerSearchLabel')}</Label>
        <Input
          id="wholesale-partner-search"
          value={q}
          maxLength={100}
          placeholder={t('partnerSearchPlaceholder')}
          aria-describedby="wholesale-partner-search-hint"
          onChange={(event) => setQ(event.target.value)}
        />
        <p id="wholesale-partner-search-hint" className="mt-1 text-xs text-muted">{t('partnerSearchHint')}</p>
      </div>
      {results.state.status === 'loading' ? <p className="text-xs text-muted" role="status">{t('partnerSearching')}</p> : null}
      {results.state.status === 'error' ? <p role="alert" className="text-xs text-negative">{t('partnerSearchError')}</p> : null}
      {results.state.status === 'ready' && results.state.data.length === 0 ? <p className="text-xs text-muted">{t('partnerSearchEmpty')}</p> : null}
      {results.state.status === 'ready' && results.state.data.length > 0 ? (
        <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded border border-border" aria-label={t('partnerResults')}>
          {results.state.data.map((partner) => (
            <li key={partner.id} className="flex items-center justify-between gap-2 p-2">
              <div className="min-w-0">
                <bdi className="block truncate font-medium text-text">{partner.name}</bdi>
                <span className="block truncate text-xs text-muted" dir="ltr">{[partner.code, partner.phone ?? partner.email].filter(Boolean).join(' · ') || '—'}</span>
                <span className="block text-xs text-muted">{partner.has_price_list ? t('partnerHasList') : t('partnerNoList')}</span>
              </div>
              <Button type="button" variant="primary" size="sm" className="min-h-11 shrink-0 sm:min-h-8" disabled={busy} onClick={() => onPick(partner)}>
                {t('linkAction')}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
