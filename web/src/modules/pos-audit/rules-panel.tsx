'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import type { RuleRow } from './types';

interface Props {
  canManage: boolean;
  canRecalculate: boolean;
}

/** إعداد قواعد الكشف — أقسام مجمّعة بالفئة، والضبط المتقدّم مطويّ افتراضياً. */
export function RulesPanel({ canManage, canRecalculate }: Props) {
  const t = useTranslations('posAudit');
  const { success, error: errorToast } = useToast();
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await api<{ data: RuleRow[] }>('/pos/audit/rules');
      setRules(result.data);
    } catch (error) {
      setRules([]);
      setLoadError(error instanceof ApiError ? error.message : t('loadFailed'));
      errorToast(error instanceof ApiError ? error.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [errorToast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(rule: RuleRow, changes: Partial<RuleRow>) {
    setSaving(rule.rule_key);
    try {
      const result = await api<{ data: RuleRow }>(`/pos/audit/rules/${rule.rule_key}`, { method: 'PUT', body: changes });
      setRules((current) => current.map((item) => (item.rule_key === rule.rule_key ? { ...item, ...result.data } : item)));
      success(t('ruleSaved'));
    } catch (error) {
      errorToast(error instanceof ApiError ? error.message : t('loadFailed'));
    } finally {
      setSaving(null);
    }
  }

  async function recalculate() {
    setRecalculating(true);
    try {
      await api('/pos/audit/recalculate', { method: 'POST' });
      success(t('recalculated'));
    } catch (error) {
      errorToast(error instanceof ApiError ? error.message : t('loadFailed'));
    } finally {
      setRecalculating(false);
    }
  }

  const grouped = rules.reduce<Record<string, RuleRow[]>>((acc, rule) => {
    (acc[rule.category] ??= []).push(rule);
    return acc;
  }, {});

  const ruleLabel = (key: string) => String(t(`rules.${key}` as never, { fallback: key }));

  if (loading) {
    return <div className="h-40 animate-pulse rounded border border-border bg-surface" />;
  }

  if (loadError) {
    return (
      <div className="rounded border border-border bg-surface p-4" role="alert">
        <p className="text-sm text-negative">{loadError}</p>
        <Button className="mt-3" size="sm" variant="outline" onClick={() => void load()}>{t('retry')}</Button>
      </div>
    );
  }

  if (rules.length === 0) {
    return <p className="rounded border border-border bg-surface p-4 text-sm text-muted">{t('emptyRules')}</p>;
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">{t('rulesHint')}</p>
        {canRecalculate ? (
          <Button variant="outline" onClick={() => void recalculate()} disabled={recalculating}>
            <RefreshCw className="h-4 w-4" strokeWidth={1.6} />
            {recalculating ? t('recalculating') : t('recalculate')}
          </Button>
        ) : null}
      </div>

      {Object.entries(grouped).map(([category, categoryRules]) => (
        <details key={category} className="rounded border border-border bg-surface" open>
          <summary className="cursor-pointer list-none p-3 text-sm font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t(`categories.${category}` as never, { fallback: category })}
          </summary>
          <ul className="divide-y divide-border border-t border-border">
            {categoryRules.map((rule) => (
              <li key={rule.rule_key} className="p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-text">{ruleLabel(rule.rule_key)}</p>
                    <p className="num mt-0.5 text-xs text-muted">{rule.rule_key} · v{rule.version}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={rule.is_enabled ? 'positive' : 'muted'}>{rule.is_enabled ? t('enabled') : t('disabled')}</Badge>
                    {canManage ? (
                      <Button size="sm" variant="outline" disabled={saving === rule.rule_key} onClick={() => void patch(rule, { is_enabled: !rule.is_enabled })}>
                        {rule.is_enabled ? t('disable') : t('enable')}
                      </Button>
                    ) : null}
                  </div>
                </div>
                {canManage ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{t('advancedTuning')}</summary>
                    <div className="mt-2 grid gap-3 sm:grid-cols-3">
                      <TuneField label={t('weight')} defaultValue={rule.weight} onCommit={(value) => void patch(rule, { weight: value })} />
                      <TuneField label={t('minSample')} defaultValue={rule.min_sample} onCommit={(value) => void patch(rule, { min_sample: value })} />
                      <TuneField label={t('windowDaysLabel')} defaultValue={rule.window_days} onCommit={(value) => void patch(rule, { window_days: value })} />
                      <TuneField label={t('threshold')} defaultValue={rule.threshold} onCommit={(value) => void patch(rule, { threshold: value })} />
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}

function TuneField({ label, defaultValue, onCommit }: { label: string; defaultValue: number; onCommit: (value: number) => void }) {
  const [value, setValue] = useState(String(defaultValue));
  useEffect(() => setValue(String(defaultValue)), [defaultValue]);

  return (
    <label className="text-xs">
      <span className="mb-1 block text-muted">{label}</span>
      <Input
        className="num"
        inputMode="numeric"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          const parsed = Number(value);
          if (Number.isFinite(parsed) && parsed >= 0 && String(parsed) !== String(defaultValue)) onCommit(parsed);
        }}
      />
    </label>
  );
}
