'use client';

/**
 * الأزواج المعكوسة (`GET …/reversed-pairs`، D-PS-15): تُعرض للقراءة، ويُربط بها سطر **يدوياً فقط** وبعضو واحد (`original|reversal`) لزوج `reviewable`؛ لا ربط تلقائي أبداً (R-REV).
 * الزوج غير القابل للمراجعة يُعرض بسبب حجبه مترجَماً. العضو المحجوز بقرار آخر معطّل.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '@/components/nebrax';
import { describeError } from '../errors';
import { fetchReversedPairs } from './client';
import { Money } from './presentation';
import { unitKind } from './candidate-picker';
import type { PairMember, ReversedPair } from './types';

const BLOCKED = ['pair_not_proven', 'pair_not_simple', 'pair_incomplete', 'unit_not_a_reversed_pair'];

export function ReversedPairsPanel({
  reconciliationId,
  onLink,
  linkLabel,
  activeLineId = null,
}: {
  reconciliationId: string;
  /** السطر الجاري ربطه: عضو محجوز **بقرار هذا السطر** يبقى قابلاً للاختيار (تجديد قراره على تشغيلة جديدة)؛ المحجوز لسطر آخر أو لسطر غير مقروء يُعطَّل. */
  activeLineId?: string | null;
  /** يظهر زر الربط فقط حين يُمرَّر (داخل تفاصيل سطر قابل للكتابة). */
  onLink?: (pair: ReversedPair, member: PairMember) => void;
  linkLabel?: (member: PairMember) => string;
}) {
  const t = useTranslations('partnerStatements');
  const [pairs, setPairs] = useState<ReversedPair[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setPairs(null);
    fetchReversedPairs(reconciliationId)
      .then((response) => {
        setPairs(response.pairs);
        setTruncated(response.truncated);
      })
      .catch((err: unknown) => setError(describeError(err).key));
  }, [reconciliationId]);

  useEffect(load, [load]);

  if (error) return <ErrorState message={t(`errors.${error}`)} onRetry={load} retryLabel={t('retry')} />;
  if (pairs === null) return <LoadingState />;
  if (pairs.length === 0) return <EmptyState titleAs="h2" title={t('workspace.pairs.empty')} description={t('workspace.pairs.empty_hint')} />;

  return (
    <div className="space-y-3" data-testid="reversed-pairs">
      <p className="text-sm leading-relaxed text-muted">{t('workspace.pairs.intro')}</p>
      <ul className="space-y-2">
        {pairs.map((pair) => (
          <li key={pair.unit_key} className="space-y-2 rounded-md border border-border bg-surface p-3" data-testid="reversed-pair">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-text" dir="auto">{pair.entry_numbers?.join(' ↔ ') || pair.unit_key}</span>
              <span className="text-xs text-muted">{t(`workspace.unit_kind.${unitKind(pair.kind ?? '')}`)}</span>
            </div>
            {pair.reviewable ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {(['original', 'reversal'] as const).map((member) => {
                  const view = pair[member];
                  if (!view) return null;
                  const ownClaim = view.claimed && activeLineId !== null && view.line_id === activeLineId;
                  const blocked = view.claimed && !ownClaim;
                  return (
                    <div key={member} className="flex items-center justify-between gap-2 rounded border border-border p-2 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-text">{t(`workspace.pairs.member_${member}`)} <span className="num" dir="ltr">{view.number ?? ''}</span></p>
                        <p className="text-xs text-muted"><span className="num" dir="ltr">{view.date ?? '—'}</span> · <Money minor={view.net_minor} signed /></p>
                        {blocked ? <p className="text-xs text-warning">{t('workspace.pairs.claimed')}</p> : null}
                        {ownClaim ? <p className="text-xs text-muted" data-testid="pair-own-claim">{t('workspace.pairs.claimed_by_this_line')}</p> : null}
                      </div>
                      {onLink ? (
                        <Button type="button" size="sm" variant="outline" className="min-h-[44px] shrink-0 md:min-h-8" disabled={blocked} onClick={() => onLink(pair, member)}>
                          <Link2 className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                          {linkLabel ? linkLabel(member) : t('workspace.pairs.link')}
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-warning" data-testid="pair-blocked">
                {t(`workspace.pairs.blocked_${BLOCKED.includes(pair.blocked_reason ?? '') ? pair.blocked_reason : 'other'}`)}
              </p>
            )}
          </li>
        ))}
      </ul>
      {truncated ? <p className="text-xs text-muted">{t('workspace.pairs.truncated')}</p> : null}
    </div>
  );
}
