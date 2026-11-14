'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Save } from 'lucide-react';
import { ErrorState, LoadingState } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { zonedLocalToIso } from '@/lib/formatting';
import { classifyError, hasPermission, serverMessage } from '../access';
import { Field } from '../fields';
import { getEvaluation, getPostingSettings, listLedgerAccounts, savePostingSettings, type PostingState } from './client';
import {
  candidateAccounts, clearingReasonFromMessage, CONFIG_BLOCKERS, CONFIG_NOTICES, COST_RECOGNITIONS, DEFAULT_VALUES, INHERIT, postingChanges, toDraft, touchesGovernance, UNSET, VARIANCE_POLICIES,
  type ClearingReason, type Evaluation, type LedgerAccount, type PostingDraft, type PostingField, type PostingValues,
} from './logic';

const MANAGE = 'fuel_stations.manage';
const GOVERNANCE = 'fuel.governance.manage';
const ACCOUNTS_VIEW = 'accounts.view';
export const INVENTORY_SETTINGS_PERMISSION = 'fuel.tanker.fill.inventory.view';

type CardState = 'loading' | 'ready' | 'unavailable' | 'error';

/**
 * بطاقة «إعدادات الدمج المخزني» داخل شاشة إعدادات تعبئة الصهاريج (TANKER-PR6B-1): الحساب الوسيط، توقيت الاعتراف بالتكلفة، سياسة انحراف المجمّع، بدء الترحيل، التنبيهات.
 * **تخزين وتحقق وعرض فقط — لا خصم ولا قيد ولا ترحيل، وحفظ هذه الإعدادات لا يعني السماح بالترحيل** (بوابة التشغيل مغلقة). الخادم هو السلطة (الحوكمة، نوع الحساب، النطاق، التدقيق)؛
 * الواجهة تعطّل ما لا يملكه المستخدم وتعرض رفض الخادم كما هو. لا مبالغ في هذه البطاقة، واسم/كود الحساب لمن يملك `accounts.view` فقط.
 */
export function InventorySettingsCard({ stationId, permissions, canManage, canGovern }: { stationId: string; permissions: string[] | null; canManage: boolean; canGovern: boolean }) {
  const t = useTranslations('fuelTankers.inventorySettings');
  const { success } = useToast();
  const allowed = hasPermission(permissions, INVENTORY_SETTINGS_PERMISSION);
  const canListAccounts = hasPermission(permissions, ACCOUNTS_VIEW);
  const stationScope = stationId !== '';

  const [state, setState] = useState<CardState>('loading');
  const [org, setOrg] = useState<PostingValues>(DEFAULT_VALUES);
  const [values, setValues] = useState<PostingValues>(DEFAULT_VALUES);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [initial, setInitial] = useState<PostingDraft>(toDraft(DEFAULT_VALUES));
  const [draft, setDraft] = useState<PostingDraft>(toDraft(DEFAULT_VALUES));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [rejection, setRejection] = useState<ClearingReason | null>(null);
  const sequence = useRef(0);

  const apply = useCallback((current: PostingState, orgValues: PostingValues) => {
    const start = toDraft(current.values, current.overrides);
    setOrg(orgValues);
    setValues(current.values);
    setInitial(start);
    setDraft(start);
  }, []);

  const load = useCallback(async () => {
    const mine = ++sequence.current;
    setState('loading');
    try {
      const [current, tenant, evaluated, list] = await Promise.all([
        getPostingSettings(stationId || undefined),
        stationId ? getPostingSettings() : Promise.resolve(null),
        getEvaluation(stationId || undefined),
        canListAccounts ? listLedgerAccounts().catch(() => [] as LedgerAccount[]) : Promise.resolve([] as LedgerAccount[]),
      ]);
      if (mine !== sequence.current) return;
      apply(current, (tenant ?? current).values);
      setEvaluation(evaluated);
      setAccounts(list);
      setFormError(null);
      setRejection(null);
      setState('ready');
    } catch (error) {
      if (mine !== sequence.current) return;
      setState(classifyError(error, 'list') === 'gate_closed' ? 'unavailable' : 'error');
    }
  }, [apply, canListAccounts, stationId]);

  useEffect(() => {
    if (!allowed) return;
    void load();
  }, [allowed, load]);

  const { payload, invalid } = useMemo(() => postingChanges(initial, draft, values.timezone, zonedLocalToIso), [initial, draft, values.timezone]);
  const dirty = Object.keys(payload).length > 0 || invalid.length > 0;
  const canSave = state === 'ready' && Object.keys(payload).length > 0 && invalid.length === 0 && (canGovern || (canManage && !touchesGovernance(payload)));

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    setFormError(null);
    setRejection(null);
    const scopeAtSave = sequence.current;
    try {
      const saved = await savePostingSettings(stationId || undefined, payload, reason);
      if (scopeAtSave !== sequence.current) {
        success(t('saved'));
        return;
      }
      // بعد الحفظ تُعاد القراءة من الخادم (القيمة الفعّالة وتقييم الحساب بعد الوراثة هما المرجع)، لا نفترض أن ما أُرسل هو ما حُفظ.
      const [evaluated, tenant] = await Promise.all([getEvaluation(stationId || undefined), stationId ? getPostingSettings() : Promise.resolve(null)]);
      if (scopeAtSave !== sequence.current) return;
      apply(saved, (tenant ?? saved).values);
      setEvaluation(evaluated);
      setReason('');
      success(t('saved'));
    } catch (error) {
      const problem = classifyError(error, 'write');
      const message = serverMessage(error);
      const code = clearingReasonFromMessage(message);
      if (code !== null) setRejection(code);
      else setFormError(problem === 'forbidden' ? t('governanceRefused', { governance: GOVERNANCE, manage: MANAGE }) : message ?? t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const setField = (field: PostingField, value: string) => setDraft((current) => ({ ...current, [field]: value }));

  if (!allowed) {
    return (
      <Card>
        <CardHeader><CardTitle>{t('title')}</CardTitle></CardHeader>
        <CardContent><p role="note" className="rounded-md border border-border bg-primary-soft px-3 py-2 text-sm text-text" data-inventory-settings-denied="">{t('needView', { permission: INVENTORY_SETTINGS_PERMISSION })}</p></CardContent>
      </Card>
    );
  }
  if (state === 'loading') return <Card><CardContent className="pt-4"><LoadingState variant="cards" rows={2} surface="bare" /></CardContent></Card>;
  if (state === 'unavailable') return <Card><CardHeader><CardTitle>{t('title')}</CardTitle></CardHeader><CardContent><p className="text-sm text-muted" data-inventory-settings-unavailable="">{t('unavailable')}</p></CardContent></Card>;
  if (state === 'error') return <Card><CardContent className="pt-4"><ErrorState message={t('loadFailed')} onRetry={() => void load()} /></CardContent></Card>;

  const candidates = candidateAccounts(accounts);
  const currentAccountId = draft.clearing !== INHERIT && draft.clearing !== UNSET ? draft.clearing : '';
  const known = candidates.some((account) => account.id === currentAccountId);
  const evaluationAccount = evaluation?.clearing.account ?? null;
  const editableGovernance = canGovern;
  const orgLabel = (field: PostingField): string => {
    if (field === 'clearing') return org.clearingAccountId === '' ? t('clearing.none') : accountText(org.clearingAccountId);
    if (field === 'cost') return t(`cost.option.${org.cost}`);
    if (field === 'variance') return t(`variance.option.${org.variance}`);
    if (field === 'start') return org.startAt === '' ? t('start.notSet') : toDraft(org)[field];
    return org.alerts ? t('alerts.on') : t('alerts.off');
  };
  function accountText(id: string): string {
    const found = accounts.find((account) => account.id === id);
    return found ? `${found.code} — ${found.name}` : t('clearing.assignedHidden');
  }
  const inheritOption = (field: PostingField) => (stationScope ? <option value={INHERIT}>{t('inherit', { value: orgLabel(field) })}</option> : null);

  return (
    <Card data-inventory-settings="">
      <CardHeader><CardTitle>{t('title')}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted">{t('intro')}</p>
        <p role="note" className="rounded-md border border-border bg-primary-soft px-3 py-2 text-sm text-text" data-inventory-settings-gate="">{evaluation?.postingGateOpen ? t('gateOpenNote') : t('gateClosedNote')}</p>

        <section aria-labelledby="inv-settings-status" className="space-y-2 rounded-md border border-border p-3" data-inventory-settings-status="">
          <h3 id="inv-settings-status" className="text-sm font-medium text-text">{t('status.title')}</h3>
          {evaluation && evaluation.blockers.length === 0 ? <Badge tone="positive">{t('status.ready')}</Badge> : null}
          {evaluation && evaluation.blockers.length > 0 ? (
            <ul className="space-y-1.5" data-inventory-settings-blockers="">
              {evaluation.blockers.map((code) => (
                <li key={code} className="flex flex-wrap items-start gap-2 text-sm text-text">
                  <Badge tone="warning" wrap>{(CONFIG_BLOCKERS as readonly string[]).includes(code) ? t(`blocker.${code}`) : t('blocker.unknown')}</Badge>
                </li>
              ))}
            </ul>
          ) : null}
          {evaluation && evaluation.clearing.reason !== null ? <p role="alert" className="text-sm text-negative" data-inventory-settings-reason="">{t(`reason.${evaluation.clearing.reason}`)}</p> : null}
          {evaluation && evaluation.notices.length > 0 ? (
            <ul className="space-y-1 text-xs text-muted">
              {evaluation.notices.map((code) => <li key={code}>{(CONFIG_NOTICES as readonly string[]).includes(code) ? t(`notice.${code}`) : t('notice.unknown')}</li>)}
            </ul>
          ) : null}
        </section>

        <Field id="inv-settings-clearing" label={t('clearing.label')} hint={t('clearing.hint')}>
          <Select value={draft.clearing} disabled={!editableGovernance || !canListAccounts || saving} onChange={(event) => { setRejection(null); setField('clearing', event.target.value); }}>
            {inheritOption('clearing')}
            {stationScope ? null : <option value={UNSET}>{t('clearing.none')}</option>}
            {currentAccountId !== '' && !known ? <option value={currentAccountId}>{evaluationAccount ? `${evaluationAccount.code} — ${evaluationAccount.name}` : t('clearing.assignedHidden')}</option> : null}
            {candidates.map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}
          </Select>
        </Field>
        {!canListAccounts ? <p className="text-xs text-muted">{t('clearing.needAccountsView', { permission: ACCOUNTS_VIEW })}</p> : null}
        {canListAccounts && candidates.length === 0 ? <p className="text-xs text-muted" data-inventory-settings-no-accounts="">{t('clearing.noCandidates')}</p> : null}
        {rejection !== null ? <p role="alert" className="text-sm text-negative" data-inventory-settings-rejection="">{t(`reason.${rejection}`)}</p> : null}
        <p className="text-xs text-muted">{t('clearing.createHint')}</p>

        <Field id="inv-settings-cost" label={t('cost.label')} hint={t('cost.hint')}>
          <Select value={draft.cost} disabled={!editableGovernance || saving} onChange={(event) => setField('cost', event.target.value)}>
            {inheritOption('cost')}
            {COST_RECOGNITIONS.map((value) => <option key={value} value={value}>{t(`cost.option.${value}`)}</option>)}
          </Select>
        </Field>
        <p className="text-xs text-muted">{t('cost.note')}</p>

        <Field id="inv-settings-variance" label={t('variance.label')} hint={t('variance.hint')}>
          <Select value={draft.variance} disabled={!editableGovernance || saving} onChange={(event) => setField('variance', event.target.value)}>
            {inheritOption('variance')}
            {VARIANCE_POLICIES.map((value) => <option key={value} value={value}>{t(`variance.option.${value}`)}</option>)}
          </Select>
        </Field>

        <details className="rounded-md border border-border px-3 py-2" data-inventory-settings-advanced="">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-text">{t('advanced')}</summary>
          <div className="space-y-3 pb-2">
            <Field id="inv-settings-start" label={t('start.label', { zone: values.timezone })} hint={t('start.hint')}>
              <Input type="datetime-local" dir="ltr" value={draft.start === INHERIT ? '' : draft.start} disabled={!editableGovernance || saving || draft.start === INHERIT} onChange={(event) => setField('start', event.target.value)} />
            </Field>
            {stationScope ? (
              <label className="flex min-h-11 items-center gap-2 text-sm text-text">
                <input type="checkbox" className="h-5 w-5 accent-[var(--primary)]" checked={draft.start === INHERIT} disabled={!editableGovernance || saving} onChange={(event) => setField('start', event.target.checked ? INHERIT : initial.start === INHERIT ? '' : initial.start)} />
                {t('inherit', { value: orgLabel('start') })}
              </label>
            ) : null}
            {invalid.includes('start') ? <p role="alert" className="text-xs text-negative">{t('start.invalid')}</p> : null}

            <Field id="inv-settings-alerts" label={t('alerts.label')} hint={t('alerts.hint')}>
              <Select value={draft.alerts} disabled={!canManage || saving} onChange={(event) => setField('alerts', event.target.value)}>
                {inheritOption('alerts')}
                <option value="true">{t('alerts.on')}</option>
                <option value="false">{t('alerts.off')}</option>
              </Select>
            </Field>
            <p className="text-xs text-muted">{t('fixedNote')}</p>
          </div>
        </details>

        <Field id="inv-settings-reason" label={t('reasonLabel')} hint={t('reasonHint')}>
          <Input value={reason} maxLength={500} disabled={!canManage || saving} onChange={(event) => setReason(event.target.value)} />
        </Field>
        {!canGovern ? <p role="note" className="text-xs text-muted">{t('governanceNeeded', { governance: GOVERNANCE, manage: MANAGE })}</p> : null}
        {formError ? <p role="alert" className="text-sm text-negative">{formError}</p> : null}
        <Button type="button" className="max-md:h-11" disabled={!canSave || saving || !dirty} onClick={() => void save()}>
          <Save className="h-4 w-4" aria-hidden="true" />{saving ? t('saving') : t('save')}
        </Button>
      </CardContent>
    </Card>
  );
}
