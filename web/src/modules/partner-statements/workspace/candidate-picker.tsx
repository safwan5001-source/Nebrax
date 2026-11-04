'use client';

/**
 * منتقي وحدات الدفتر لقرار `override` (IMP-PS-A4b): مرشّحو المحرّك + اقتراحاته + وحدات الدفتر غير المطابَقة. **التحقق إلزامي قبل التجاوز**: `verify-set` (قراءة فقط) لنفس المجموعة المختارة حرفياً؛
 * أي تغيير في الاختيار يُبطل نتيجته. المجموعة غير المتساوية ضمن التسامح لا تُعتمد إلا بإقرار صريح (`accept_difference`) في النموذج — والمشاكل (`problems`) تمنع دائماً.
 */
import { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { describeError } from '../errors';
import { verifySet } from './client';
import { MAX_UNIT_SET } from './decision-rules';
import { verifyProblemKey, safeParams } from './explanation';
import { Money } from './presentation';
import type { MatchRow, Suggestion, UnitSnapshot, VerifySetResponse } from './types';

/** نتيجة تحقق مربوطة بتوقيع المجموعة التي أُجري عليها (أي تغيير في الاختيار يُبطلها). */
export interface VerifiedSet {
  signature: string;
  result: VerifySetResponse;
}

export const selectionSignature = (keys: readonly string[]): string => [...keys].sort().join('|');

export function CandidatePicker({
  reconciliationId,
  lineId,
  row,
  ledgerUnits,
  selected,
  verify,
  onSelect,
  onVerified,
}: {
  reconciliationId: string;
  lineId: string;
  row: Pick<MatchRow, 'candidates' | 'unit' | 'suggestions'>;
  ledgerUnits: UnitSnapshot[];
  /** الاختيار والتحقق **مرفوعان إلى المالك** كي لا يضيعا إن انقلب التخطيط (دوران الجهاز/تغيير النافذة) فأُعيد تركيب اللوحة. */
  selected: string[];
  verify: VerifiedSet | null;
  onSelect: (keys: string[]) => void;
  onVerified: (verified: VerifiedSet) => void;
}) {
  const t = useTranslations('partnerStatements');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const seq = useRef(0);

  const engineUnits = useMemo(() => {
    const list = [...(row.candidates ?? []), ...(row.unit ? [row.unit] : [])];
    return dedupe(list);
  }, [row.candidates, row.unit]);
  const engineKeys = useMemo(() => new Set(engineUnits.map((unit) => unit.key)), [engineUnits]);
  const otherUnits = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return dedupe(ledgerUnits)
      .filter((unit) => !engineKeys.has(unit.key))
      .filter((unit) => needle === '' || `${unit.doc_number ?? ''} ${unit.key} ${unit.date ?? ''}`.toLowerCase().includes(needle));
  }, [ledgerUnits, engineKeys, search]);

  const signature = selectionSignature(selected);
  const verified = verify !== null && verify.signature === signature ? verify.result : null;

  const toggle = (key: string) => {
    setErrorKey(null);
    onSelect(selected.includes(key) ? selected.filter((value) => value !== key) : selected.length >= MAX_UNIT_SET ? selected : [...selected, key]);
  };

  async function runVerify() {
    if (selected.length === 0 || loading) return;
    const mine = ++seq.current;
    setLoading(true);
    setErrorKey(null);
    try {
      const result = await verifySet(reconciliationId, lineId, selected);
      if (mine === seq.current) onVerified({ signature: selectionSignature(selected), result });
    } catch (error) {
      if (mine === seq.current) setErrorKey(describeError(error).key);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }

  const renderUnit = (unit: UnitSnapshot) => {
    const checked = selected.includes(unit.key);
    const label = `${unit.doc_number ?? unit.key}`;
    return (
      <li key={unit.key}>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded border border-border px-2 py-1.5 text-sm hover:bg-background md:min-h-9">
          <input type="checkbox" className="h-4 w-4 shrink-0" checked={checked} onChange={() => toggle(unit.key)} aria-label={t('workspace.picker.select_unit', { unit: label })} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-text" dir="auto">{label}</span>
            <span className="block text-xs text-muted">
              {unit.kind ? t(`workspace.unit_kind.${unitKind(unit.kind)}`) : ''} · <span className="num" dir="ltr">{unit.date ?? '—'}</span>
              {unit.direction ? ` · ${t(`workspace.direction.${unit.direction === 'debit' ? 'debit' : 'credit'}`)}` : ''}
              {unit.state !== 'active' ? ` · ${t('workspace.picker.not_active')}` : ''}
            </span>
          </span>
          <Money minor={unit.amount_minor} />
        </label>
      </li>
    );
  };

  return (
    <div className="space-y-3" data-testid="candidate-picker">
      {(row.suggestions ?? []).length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted">{t('workspace.picker.suggestions')}</p>
          <div className="flex flex-wrap gap-2">
            {(row.suggestions ?? []).map((suggestion: Suggestion, index) => (
              <Button key={suggestion.unit_keys.join('|')} type="button" size="sm" variant="outline" className="min-h-[44px] md:min-h-8" onClick={() => { setErrorKey(null); onSelect([...suggestion.unit_keys]); }}>
                {t('workspace.picker.use_suggestion', { index: index + 1, count: suggestion.unit_keys.length })}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {engineUnits.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted">{t('workspace.picker.engine_units')}</p>
          <ul className="space-y-1.5">{engineUnits.map(renderUnit)}</ul>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted">{t('workspace.picker.ledger_units')}</p>
        <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('workspace.picker.search')} aria-label={t('workspace.picker.search')} maxLength={60} />
        {otherUnits.length === 0 ? (
          <p className="text-xs text-muted">{t('workspace.picker.no_units')}</p>
        ) : (
          <ul className="max-h-56 space-y-1.5 overflow-y-auto pe-1">{otherUnits.slice(0, 100).map(renderUnit)}</ul>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">{t('workspace.picker.selected', { count: selected.length })}</span>
        <Button type="button" variant="outline" className="ms-auto min-h-[44px] md:min-h-9" disabled={selected.length === 0 || loading} onClick={() => void runVerify()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />}
          {t('workspace.picker.verify')}
        </Button>
      </div>

      {errorKey ? <p role="alert" className="text-sm text-negative">{t(`errors.${errorKey}`)}</p> : null}
      {selected.length > 0 && verified === null && !loading && !errorKey ? <p className="text-xs text-warning" data-testid="verify-required">{t('workspace.picker.verify_required')}</p> : null}

      {verified ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md border border-border bg-background p-3 text-sm" data-testid="verify-result" data-equal={verified.equal_within_tolerance}>
          <dt className="text-muted">{t('workspace.picker.expected')}</dt>
          <dd className="text-end"><Money minor={verified.expected_net_minor} signed /></dd>
          <dt className="text-muted">{t('workspace.picker.set_net')}</dt>
          <dd className="text-end"><Money minor={verified.set_net_minor} signed /></dd>
          <dt className="font-medium text-text">{t('workspace.picker.difference')}</dt>
          <dd className="text-end font-medium"><Money minor={verified.difference_minor} signed /></dd>
          <dt className="text-muted">{t('workspace.picker.tolerance')}</dt>
          <dd className="text-end"><Money minor={verified.tolerance_minor} /></dd>
          <dd className={`col-span-2 text-xs ${verified.equal_within_tolerance ? 'text-positive' : 'text-warning'}`}>
            {verified.equal_within_tolerance ? t('workspace.picker.equal') : t('workspace.picker.not_equal')}
          </dd>
          {verified.problems.map((problem, index) => (
            <dd key={`${problem.code}-${index}`} className="col-span-2 text-xs text-negative" data-testid="verify-problem">
              {t(`workspace.verify_problem.${verifyProblemKey(problem.code)}`, safeParams(problem.params))}
            </dd>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function dedupe(units: readonly UnitSnapshot[]): UnitSnapshot[] {
  const seen = new Set<string>();
  return units.filter((unit) => (seen.has(unit.key) ? false : (seen.add(unit.key), true)));
}

const KNOWN_KINDS = ['invoice', 'credit_note', 'payment', 'purchase', 'debit_note', 'return'];
export const unitKind = (kind: string): string => (KNOWN_KINDS.includes(kind) ? kind : 'other');
