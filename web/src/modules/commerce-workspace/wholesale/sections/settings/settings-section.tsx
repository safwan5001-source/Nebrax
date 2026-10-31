'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import type { ColumnDef } from '@tanstack/react-table';
import { ExternalLink } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SectionPage } from '../../components/section-page';
import { UnavailablePanel } from '../../components/unavailable-panel';
import { ChannelConfig } from './channel-config';
import { COMMERCIAL_RULES, type CommercialRuleKey } from './commercial-rules';
import { settingsMessages, type SettingsMessageKey } from './messages';

export const SALES_SETTINGS_HREF = '/sales-settings';

type RuleRow = (typeof COMMERCIAL_RULES)[number];

/**
 * Wholesale Settings — channel configuration (the only write on this screen, behind a confirmation), the buyer-access
 * policy as facts, and the commercial-rules contract as a read-only table. No input exists for any rule whose
 * decision is still open.
 */
export function SettingsSection() {
  const locale = useLocale();
  const { t } = settingsMessages.forLocale(locale);

  return (
    <SectionPage sectionKey="settings" description={t('description')}>
      <div className="space-y-8">
        <ChannelConfig />
        <BuyerPolicy />
        <CommercialRules />
      </div>
    </SectionPage>
  );
}

const POLICY_KEYS = ['policy1', 'policy2', 'policy3', 'policy4', 'policy5'] as const;

function BuyerPolicy() {
  const { t } = settingsMessages.forLocale(useLocale());
  return (
    <section aria-labelledby="ws-policy-title" className="space-y-3">
      <div>
        <h2 id="ws-policy-title" className="text-base font-semibold text-text">{t('policyTitle')}</h2>
        <p className="text-sm text-muted">{t('policyHint')}</p>
      </div>
      <ol className="space-y-2 rounded border border-border bg-surface p-4">
        {POLICY_KEYS.map((key, index) => (
          <li key={key} className="flex gap-3 text-sm leading-relaxed text-text">
            <span aria-hidden className="num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary-soft text-xs text-primary">
              {index + 1}
            </span>
            <span>{t(key)}</span>
          </li>
        ))}
        <li className="num pt-1 text-xs text-muted" dir="ltr">{t('policyRef')}</li>
      </ol>
      <UnavailablePanel title={t('policyDeferredTitle')} description={t('policyDeferredDescription')} blocker={t('policyDeferredBlocker')} />
    </section>
  );
}

function CommercialRules() {
  const locale = useLocale();
  const { t } = settingsMessages.forLocale(locale);
  const ruleText = (key: CommercialRuleKey, part: 'name' | 'today' | 'proposed') => t(`rule.${key}.${part}` as SettingsMessageKey);
  const decisions = (row: RuleRow) => row.decisions.map((id) => t(`decision.${id}` as SettingsMessageKey));

  const columns = useMemo<ColumnDef<RuleRow, unknown>[]>(
    () => [
      { id: 'rule', header: t('colRule'), accessorFn: (row) => ruleText(row.key, 'name'), cell: ({ row }) => <span className="font-medium">{ruleText(row.original.key, 'name')}</span> },
      { id: 'today', header: t('colToday'), enableSorting: false, accessorFn: (row) => ruleText(row.key, 'today') },
      { id: 'proposed', header: t('colProposed'), enableSorting: false, accessorFn: (row) => ruleText(row.key, 'proposed') },
      {
        id: 'decision',
        header: t('colDecision'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex flex-col items-start gap-1">
            {decisions(row.original).map((text) => (
              <Badge key={text} tone="muted" wrap>{text}</Badge>
            ))}
            <Badge tone="warning" wrap>{t('notConfigurable')}</Badge>
          </span>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );

  return (
    <section aria-labelledby="ws-rules-title" className="space-y-3">
      <div>
        <h2 id="ws-rules-title" className="text-base font-semibold text-text">{t('rulesTitle')}</h2>
        <p className="text-sm text-muted">{t('rulesHint')}</p>
      </div>
      <DataTable<RuleRow>
        columns={columns}
        data={[...COMMERCIAL_RULES]}
        showToolbar={false}
        mobileRecord={(row) => ({
          title: ruleText(row.key, 'name'),
          subtitle: `${t('colToday')}: ${ruleText(row.key, 'today')}`,
          caption: `${t('colProposed')}: ${ruleText(row.key, 'proposed')}`,
          status: (
            <span className="flex flex-wrap gap-1">
              {decisions(row).map((text) => (
                <Badge key={text} tone="muted" wrap>{text}</Badge>
              ))}
              <Badge tone="warning" wrap>{t('notConfigurable')}</Badge>
            </span>
          ),
        })}
      />
      <p className="num text-xs text-muted" dir="ltr">{t('rulesRef')}</p>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-surface p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">{t('salesSettings')}</p>
          <p className="text-sm text-muted">{t('salesSettingsHint')}</p>
        </div>
        <Button asChild variant="outline">
          <Link href={SALES_SETTINGS_HREF}>
            <ExternalLink aria-hidden className="h-4 w-4" strokeWidth={1.7} />
            {t('salesSettings')}
          </Link>
        </Button>
      </div>
    </section>
  );
}
