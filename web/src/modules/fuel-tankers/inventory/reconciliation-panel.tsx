'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ErrorState, LoadingState } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMinorRiyal } from '@/lib/money';
import { getReconciliation } from './client';
import { isKnownAccountSource, isKnownFinding, isKnownLimit, litersOf, type ReconBranch, type Reconciliation } from './logic';

type Phase = 'loading' | 'ready' | 'error';

/**
 * TANKER-PR6B-0 — مطابقة مجمّع تكلفة الوقود مع رصيد المخزن والأستاذ العام. **عرض فقط**: لا تسوية ولا ترحيل ولا زر كتابة؛ الخادم هو السلطة في كل رقم وحالة.
 * القيمة (هللات ⇒ ريال في طبقة العرض فقط) لا تصل إلا لمن يملك `products.view_cost` وغير المقيَّد بمخزن/محطة — غير ذلك يُعلن الخادم نطاق القيمة ولا تُرسَل مبالغ.
 */
export function ReconciliationPanel() {
  const t = useTranslations('fuelTankers.inventory');
  const [phase, setPhase] = useState<Phase>('loading');
  const [data, setData] = useState<Reconciliation | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const mine = ++sequence.current;
    setPhase('loading');
    try {
      const result = await getReconciliation();
      if (mine !== sequence.current) return;
      setData(result);
      setPhase('ready');
    } catch {
      if (mine === sequence.current) setPhase('error');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (phase === 'loading') return <LoadingState variant="cards" rows={2} />;
  if (phase === 'error' || data === null) return <ErrorState message={t('reconciliation.loadFailed')} onRetry={() => void load()} />;

  return (
    <Card data-reconciliation-panel="" data-consistent={data.consistent ? 'true' : 'false'}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t('reconciliation.title')}</CardTitle>
          <Badge tone={data.consistent ? 'positive' : 'negative'} data-reconciliation-status="">{data.consistent ? t('reconciliation.status.consistent') : t('reconciliation.status.differences')}</Badge>
        </div>
        <p className="text-sm text-muted">{t('reconciliation.hint')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <QuantitySection data={data} />
        <ValueSection data={data} />
        {data.findings.length > 0 ? (
          <section aria-label={t('reconciliation.findings.title')} data-reconciliation-findings="">
            <h3 className="mb-1.5 text-sm font-semibold text-text">{t('reconciliation.findings.title')}</h3>
            <ul className="flex flex-wrap gap-1.5">
              {data.findings.map((finding, index) => (
                <li key={`${finding.code}-${index}`}>
                  <Badge tone={finding.severity === 'error' ? 'negative' : 'warning'} wrap>
                    {isKnownFinding(finding.code) ? t(`reconciliation.findings.${finding.code}`) : t('reconciliation.findings.unknown')}{finding.count !== null ? ` (${finding.count})` : ''}
                  </Badge>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <AccountsSection data={data} />
        {data.notChecked.length > 0 ? (
          <details className="rounded-md border border-border px-3 py-2" data-reconciliation-limits="">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-text">{t('reconciliation.limits.title')}</summary>
            <ul className="list-disc space-y-1 pb-2 ps-5 text-sm text-muted">
              {data.notChecked.map((code) => <li key={code}>{isKnownLimit(code) ? t(`reconciliation.limits.${code}`) : t('reconciliation.limits.other')}</li>)}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

function QuantitySection({ data }: { data: Reconciliation }) {
  const t = useTranslations('fuelTankers.inventory');
  const s = data.poolSummary;
  return (
    <section aria-label={t('reconciliation.quantity.title')} data-reconciliation-quantity="">
      <h3 className="mb-1 text-sm font-semibold text-text">{t('reconciliation.quantity.title')}</h3>
      <p className="mb-2 text-sm text-muted">{t('reconciliation.quantity.summary', { pools: s.pools, inSync: s.inSync, mismatched: s.mismatched })}</p>
      {data.pools.length === 0 ? <p className="text-sm text-muted">{t('reconciliation.quantity.empty')}</p> : (
        <ul className="space-y-2">
          {data.pools.map((pool, index) => {
            const diff = pool.differenceMilliliters;
            return (
              <li key={index} className="space-y-1 rounded-md border border-border p-3 text-sm" data-reconciliation-pool="" data-in-sync={pool.findings.length === 0 ? 'true' : 'false'}>
                <p className="font-semibold text-text">{pool.warehouseName ?? t('reconciliation.quantity.unnamedWarehouse')} · {pool.fuelProductName ?? t('reconciliation.quantity.unnamedProduct')}</p>
                <p className="text-muted">{t('reconciliation.quantity.stock')}: <span className="num">{litersOf(pool.stockMilliliters)}</span> · {t('reconciliation.quantity.pool')}: <span className="num">{litersOf(pool.costPoolMilliliters)}</span></p>
                {diff !== null && diff !== 0 ? <p className="text-negative">{t('reconciliation.quantity.difference', { liters: litersOf(diff) })}</p> : null}
                {pool.findings.length > 0 ? (
                  <ul className="flex flex-wrap gap-1.5">{pool.findings.map((code) => <li key={code}><Badge tone="warning" wrap>{isKnownFinding(code) ? t(`reconciliation.findings.${code}`) : t('reconciliation.findings.unknown')}</Badge></li>)}</ul>
                ) : null}
                {pool.valueMinor !== null ? <p className="text-xs text-muted">{t('reconciliation.quantity.poolValue')}: <span className="num">{formatMinorRiyal(pool.valueMinor)}</span></p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ValueSection({ data }: { data: Reconciliation }) {
  const t = useTranslations('fuelTankers.inventory');
  if (data.valueScope !== 'tenant_by_branch') {
    return <p role="note" className="rounded-md border border-border bg-primary-soft px-3 py-2 text-sm text-text" data-value-hidden={data.valueScope}>{t(`reconciliation.value.${data.valueScope}`)}</p>;
  }
  return (
    <section aria-label={t('reconciliation.value.title')} data-reconciliation-value="">
      <h3 className="mb-1 text-sm font-semibold text-text">{t('reconciliation.value.title')}</h3>
      <p className="mb-2 text-sm text-muted">{t('reconciliation.value.hint')}</p>
      {data.branches.length === 0 ? <p className="text-sm text-muted">{t('reconciliation.value.empty')}</p> : <ul className="space-y-2">{data.branches.map((branch, index) => <BranchRow key={index} branch={branch} />)}</ul>}
      {data.entriesTotal > 0 ? (
        <details className="mt-2 rounded-md border border-border px-3 py-2" data-reconciliation-entries="">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-text">{t('reconciliation.entries.title', { count: data.entriesTotal })}</summary>
          <ul className="space-y-1.5 pb-2 text-sm">
            {data.entries.map((entry) => (
              <li key={entry.number} className="rounded-md border border-border p-2">
                <p className="font-medium text-text"><bdi className="num">{entry.number}</bdi> · <span className="num">{entry.entryDate}</span></p>
                <p className="text-muted">{t('reconciliation.entries.movements')}: <span className="num">{formatMinorRiyal(entry.movementDeltaMinor)}</span> · {t('reconciliation.entries.ledger')}: <span className="num">{formatMinorRiyal(entry.ledgerNetMinor)}</span></p>
                <p className="text-negative">{t('reconciliation.entries.difference')}: <span className="num">{formatMinorRiyal(entry.differenceMinor)}</span></p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

const CAUSES = [['entryAmountDiffers', 'entryAmountDiffers'], ['reversedEntries', 'reversedEntries'], ['movementsWithoutJournal', 'movementsWithoutJournal'], ['stateVsMovements', 'stateVsMovements']] as const;

function BranchRow({ branch }: { branch: ReconBranch }) {
  const t = useTranslations('fuelTankers.inventory');
  const causes = CAUSES.filter(([key]) => branch.causes[key] !== 0);
  return (
    <li className="space-y-1.5 rounded-md border border-border p-3 text-sm" data-reconciliation-branch="" data-in-sync={branch.inSync ? 'true' : 'false'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-text">{branch.branchName ?? t('reconciliation.value.noBranch')}</p>
        <Badge tone={branch.inSync ? 'positive' : 'negative'}>{branch.inSync ? t('reconciliation.value.inSync') : t('reconciliation.value.outOfSync')}</Badge>
      </div>
      <dl className="grid grid-cols-1 gap-1 sm:grid-cols-3">
        <div><dt className="text-xs text-muted">{t('reconciliation.value.pool')}</dt><dd className="num font-medium text-text">{formatMinorRiyal(branch.poolValueMinor)}</dd></div>
        <div><dt className="text-xs text-muted">{t('reconciliation.value.ledger')}</dt><dd className="num font-medium text-text">{formatMinorRiyal(branch.ledgerShareMinor)}</dd></div>
        <div><dt className="text-xs text-muted">{t('reconciliation.value.difference')}</dt><dd className="num font-medium text-text">{formatMinorRiyal(branch.differenceMinor)}</dd></div>
      </dl>
      {causes.length > 0 ? (
        <ul className="space-y-0.5 text-muted" data-reconciliation-causes="">
          {causes.map(([key]) => <li key={key}>{t(`reconciliation.causes.${key}`)}: <span className="num">{formatMinorRiyal(branch.causes[key])}</span></li>)}
        </ul>
      ) : null}
      {branch.movementsWithoutJournalCount > 0 ? <p className="text-xs text-muted">{t('reconciliation.causes.movementsWithoutJournalCount', { count: branch.movementsWithoutJournalCount })}</p> : null}
    </li>
  );
}

function AccountsSection({ data }: { data: Reconciliation }) {
  const t = useTranslations('fuelTankers.inventory');
  if (data.accounts.length === 0) return null;
  return (
    <details className="rounded-md border border-border px-3 py-2" data-reconciliation-accounts="">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-text">{t('reconciliation.accounts.title')}{data.splitInLedger || data.stationOverrides > 0 ? <> <Badge tone="warning">{t('reconciliation.accounts.attention')}</Badge></> : null}</summary>
      <div className="space-y-2 pb-2 text-sm">
        <p className="text-muted">{t('reconciliation.accounts.hint')}</p>
        <ul className="space-y-1">
          {data.accounts.map((account, index) => (
            <li key={index} className="flex flex-wrap items-center gap-1.5">
              <span className="num font-medium text-text">{account.code ?? '—'}</span> <span className="text-text">{account.name ?? ''}</span>
              {account.sources.map((source) => <Badge key={source} tone="neutral">{isKnownAccountSource(source) ? t(`reconciliation.accounts.source.${source}`) : t('reconciliation.accounts.source.other')}</Badge>)}
            </li>
          ))}
        </ul>
        {data.stationOverrides > 0 ? <p className="text-warning">{t('reconciliation.accounts.overrides', { count: data.stationOverrides })}</p> : null}
        {data.splitInLedger ? <p className="text-warning">{t('reconciliation.accounts.splitInLedger')}</p> : null}
      </div>
    </details>
  );
}
