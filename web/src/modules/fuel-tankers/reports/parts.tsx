'use client';

import { useTranslations } from 'next-intl';
import { Info, ShieldAlert, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { HiddenValue } from '../fills/parts';
import { isKnownFilterKey, isKnownFinding, isKnownScopeBasis, type Finding, type LedgerScope, type Result, type ReportMeta } from './logic';

type Tone = 'positive' | 'warning' | 'negative' | 'muted' | 'neutral';

const RESULT_TONE: Record<Result, Tone> = { matched: 'positive', mismatch: 'negative', warning: 'warning', incomplete: 'muted' };

/** نتيجة المطابقة لصف: **مؤكَّد فرق** (negative) ≠ تنبيه (warning) ≠ لم تكتمل دورته (muted) — ثلاثة مستويات لا تُخلط. */
export function ResultBadge({ result }: { result: Result }) {
  const t = useTranslations('fuelTankerReports');
  return <Badge tone={RESULT_TONE[result]} data-result={result}>{t(`result.${result}`)}</Badge>;
}

export function FindingBadges({ findings }: { findings: Finding[] }) {
  const t = useTranslations('fuelTankerReports');
  if (findings.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" data-findings="">
      {findings.map((finding, index) => (
        <li key={`${finding.code}-${index}`}>
          <Badge tone={finding.severity === 'error' ? 'negative' : finding.severity === 'warning' ? 'warning' : 'muted'} wrap data-finding={finding.code} data-severity={finding.severity}>
            {isKnownFinding(finding.code) ? t(`finding.${finding.code}`) : t('finding.unknown', { code: finding.code })}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

export interface Tile { key: string; label: string; value: React.ReactNode; tone?: 'negative' | 'warning' | 'positive' }

/** شبكة مؤشرات مختصرة (عمودان على الجوال). */
export function SummaryTiles({ tiles }: { tiles: Tile[] }) {
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" data-summary="">
      {tiles.map((tile) => (
        <div key={tile.key} className="rounded-md border border-border bg-surface p-3" data-tile={tile.key}>
          <dt className="text-xs text-muted">{tile.label}</dt>
          <dd className={`num mt-0.5 text-lg font-semibold ${tile.tone === 'negative' ? 'text-negative' : tile.tone === 'warning' ? 'text-warning' : tile.tone === 'positive' ? 'text-positive' : 'text-text'}`}>{tile.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Note({ icon: Icon, tone = 'info', children, ...rest }: { icon: typeof Info; tone?: 'info' | 'warning'; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div role="note" className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${tone === 'warning' ? 'border-warning/50 bg-warning/10 text-text' : 'border-border bg-primary-soft text-text'}`} {...rest}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone === 'warning' ? 'text-warning' : 'text-primary'}`} aria-hidden="true" />
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}

/** الفحص مقتصر على أول N سند: النتيجة المعروضة **ليست الشاملة** حين `truncated = true`. */
export function TruncatedNotice({ limit }: { limit: number | null }) {
  const t = useTranslations('fuelTankerReports');
  return (
    <Note icon={TriangleAlert} tone="warning" data-truncated="">
      <p className="font-medium">{t('truncated.title')}</p>
      <p>{limit !== null ? t('truncated.bodyLimit', { limit }) : t('truncated.body')}</p>
    </Note>
  );
}

/** نطاق **الصفوف** المعلن من الخادم: مقيَّد بمحطات المستخدم/فروعه والمرشّحات المطبَّقة فعلاً. */
export function RowScopeNotice({ meta }: { meta: ReportMeta }) {
  const t = useTranslations('fuelTankerReports');
  const { station_restricted: stations, branch_restricted: branches } = meta.row_scope;
  const applied = Object.keys(meta.filters);
  const level = stations ? 'stations' : branches ? 'branches' : 'organization';
  return (
    <Note icon={Info} data-row-scope={level}>
      <p><span className="font-medium">{t('scope.rowsTitle')}:</span> {t(`scope.rows.${level}`)}</p>
      <p data-filters-applied="">{applied.length === 0 ? t('scope.noFilters') : t('scope.filtersApplied', { filters: applied.map((k) => (isKnownFilterKey(k) || ['from', 'to', 'branch_id', 'page', 'per_page'].includes(k) ? t(`filterName.${k}`) : k)).join('، ') })}</p>
    </Note>
  );
}

/**
 * نطاق **أرصدة الأستاذ**: مستوى (مؤسسة/فروع) لا محطة. الأرصدة تُجمَّع بسطر القيد الذي يحمل الفرع لا المحطة، فلا تُعرض على أنها خاصة بمحطة،
 * والمرشّحات التي لا تؤثر فيها (`filters_not_applicable`/`balance_filters_not_applicable`) تُعلن صراحةً بدل أن تبدو مطبَّقة.
 */
export function BalanceScopeNotice({ scope, notApplicable }: { scope: LedgerScope; notApplicable: string[] }) {
  const t = useTranslations('fuelTankerReports');
  const level = scope.level === 'branches' ? 'branches' : scope.level === 'organization' ? 'organization' : 'unknown';
  const skipped = notApplicable;
  return (
    <div className="space-y-2" data-balance-scope={scope.level}>
      <Note icon={Info} data-scope-level={scope.level}>
        <p><span className="font-medium">{t('scope.balancesTitle')}:</span> <span data-scope-level-label="">{level === 'unknown' ? t('scope.level.unknown', { level: scope.level }) : t(`scope.level.${level}`)}</span></p>
        <p>{level === 'branches' ? t('scope.branchesBody', { count: scope.branch_ids?.length ?? 0 }) : t('scope.organizationBody')}</p>
        <p className="text-muted">{isKnownScopeBasis(scope.basis) ? t(`scope.basis.${scope.basis}`) : t('scope.basis.other')}</p>
        <p data-scope-applied="">{t('scope.balancesApplied', { filters: scope.filters_applied.map((k) => t(`filterName.${k}`)).join('، ') || '—' })}</p>
      </Note>
      {skipped.length > 0 ? (
        <Note icon={TriangleAlert} tone="warning" data-balance-filters-not-applicable="">
          <p className="font-medium">{t('scope.notApplicableTitle')}</p>
          <p>{t('scope.notApplicableBody', { filters: skipped.map((k) => (isKnownFilterKey(k) ? t(`filterName.${k}`) : k)).join('، ') })}</p>
        </Note>
      ) : null}
    </div>
  );
}

/** ما حجبه الخادم لغياب الصلاحية — كل صلاحية مستقلة عن الأخرى. */
export function MaskingNotice({ costs, accounts }: { costs: boolean; accounts?: boolean }) {
  const t = useTranslations('fuelTankerReports');
  if (!costs && !accounts) return null;
  return (
    <Note icon={ShieldAlert} data-masking="">
      {costs ? <p data-masking-costs="">{t('masking.costs')}</p> : null}
      {accounts ? <p data-masking-accounts="">{t('masking.accounts')}</p> : null}
    </Note>
  );
}

export function HiddenOr({ value, children }: { value: unknown; children: React.ReactNode }) {
  return value === null || value === undefined ? <HiddenValue /> : <>{children}</>;
}

export function StateBadge({ status }: { status: string }) {
  const f = useTranslations('fuelTankerFills');
  const known = status === 'pending_integration' || status === 'posted' || status === 'reversed';
  return <Badge tone={status === 'posted' ? 'positive' : status === 'pending_integration' ? 'warning' : 'muted'} data-inventory-status={status}>{known ? f(`inventoryStatus.${status}`) : status}</Badge>;
}
