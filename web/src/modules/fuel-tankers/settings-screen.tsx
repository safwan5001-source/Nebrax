'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Save } from 'lucide-react';
import { ErrorState, LoadingState, PageHeader } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { classifyError, hasPermission, serverMessage, TANKER_VIEW } from './access';
import { listOwners } from './client';
import { Field } from './fields';
import { getTankerPolicy, listStationNozzles, listStations, saveTankerPolicy, updateNozzleOperations, type NozzleRow, type PolicyState, type StationOption } from './settings-client';
import {
  ATTACHMENT_AFTER_CLOSE, ATTACHMENT_HARD_MAX_COUNT, ATTACHMENT_HARD_MAX_MB, ATTACHMENT_REMOVAL, ATTACHMENT_REQUIRED, ATTACHMENT_TYPES,
  effectiveOperations, INHERIT, isNarrowing, OVERRUN_POLICIES, POLICY_DEFAULTS, policyChanges, sameOperations, TANKER_OPERATIONS, toDraft, toStoredOperations, touchesGovernance, VOUCHER_SCOPES,
  type PolicyDraft, type PolicyField, type TankerOperation, type TankerPolicy,
} from './settings-logic';
import { ForbiddenState, GateClosedState } from './states';
import { usePermissions } from './use-permissions';

const STATIONS_VIEW = 'fuel_stations.view';
const MANAGE = 'fuel_stations.manage';
const GOVERNANCE = 'fuel.governance.manage';

type ScreenState = 'loading' | 'ready' | 'gate_closed' | 'forbidden' | 'error';

/**
 * إعدادات تعبئة صهاريج المتعاملين (قرارات المالك المعتمدة، PR-3): سياسة اختيار الصهريج، نطاق منع تكرار السند الورقي (والقواعد الثابتة)، سياسة تجاوز السعة،
 * وعمليات الفوهات المسموحة. **تخزين وتحقق فقط** — لا تعبئة ولا مخزون ولا قيد. السياسات الثلاث مفاتيح حوكمة (تتطلب `fuel.governance.manage` مع `fuel_stations.manage`)،
 * وتضييق عمليات فوهة محطتها وردية مفتوحة يتطلب الحوكمة أيضاً — **يفرضها الخادم**؛ الواجهة تعطّل ما لا تملكه وتعرض رفض الخادم كما هو.
 */
export function TankerSettingsScreen() {
  const t = useTranslations('fuelTankers');
  const { success } = useToast();
  const permissions = usePermissions();
  // القراءة تمرّ بمسارات إعدادات الوقود والمحطات (`fuel_stations.view`) إضافة إلى مسبار البوابة (`fuel.tanker.view`): كلاهما لازم، فلا نعرض شاشة تفشل بعد قبولها.
  const hasTankerView = hasPermission(permissions, TANKER_VIEW);
  const canView = hasTankerView && hasPermission(permissions, STATIONS_VIEW);
  const canManage = hasPermission(permissions, MANAGE);
  const canGovern = canManage && hasPermission(permissions, GOVERNANCE);

  const [state, setState] = useState<ScreenState>('loading');
  const [stations, setStations] = useState<StationOption[]>([]);
  const [stationId, setStationId] = useState('');
  const [orgPolicy, setOrgPolicy] = useState<TankerPolicy>(POLICY_DEFAULTS);
  // المسودة الابتدائية تحمل حالة الوراثة/التجاوز للمحطة (`inherit` لما لا تجاوز له) فلا يضيع الفرق بين «موروث» و«مثبَّت بقيمة مساوية».
  const [initial, setInitial] = useState<PolicyDraft>(toDraft(POLICY_DEFAULTS));
  const [draft, setDraft] = useState<PolicyDraft>(toDraft(POLICY_DEFAULTS));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const sequence = useRef(0);

  const stationScope = stationId !== '';

  const load = useCallback(async (scopeStation: string) => {
    const mine = ++sequence.current;
    setState('loading');
    try {
      await listOwners(); // مسبار البوابة نفسه لشاشة الأصحاب: 404 هنا وحده يعني أن الميزة مغلقة.
      const [org, list] = await Promise.all([getTankerPolicy(), listStations()]);
      if (mine !== sequence.current) return;
      let scoped: PolicyState | null = null;
      if (scopeStation) {
        try {
          scoped = await getTankerPolicy(scopeStation);
        } catch {
          if (mine !== sequence.current) return;
          // فشل إعدادات محطة (محطة غير متاحة للفرع/المستخدم…) ليس إغلاقاً للبوابة: نعود لنطاق المؤسسة مع رسالة، ويبقى المحدّد.
          setStations(list);
          setOrgPolicy(org.policy);
          const start = toDraft(org.policy, org.overrides);
          setInitial(start);
          setDraft(start);
          setScopeError(t('settings.stationUnavailable'));
          setState('ready');
          setStationId('');
          return;
        }
        if (mine !== sequence.current) return;
      }
      setStations(list);
      setOrgPolicy(org.policy);
      const start = toDraft((scoped ?? org).policy, (scoped ?? org).overrides);
      setInitial(start);
      setDraft(start);
      setFormError(null);
      setState('ready');
    } catch (error) {
      if (mine !== sequence.current) return;
      const problem = classifyError(error, 'list');
      setState(problem === 'gate_closed' ? 'gate_closed' : problem === 'forbidden' ? 'forbidden' : 'error');
    }
  }, [t]);

  useEffect(() => {
    if (permissions === null || !canView) return;
    void load(stationId);
  }, [permissions, canView, stationId, load]);

  const changes = useMemo(() => policyChanges(initial, draft), [initial, draft]);
  const dirty = Object.keys(changes).length > 0;

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setFormError(null);
    const scopeAtSave = sequence.current;
    try {
      const saved = await saveTankerPolicy(stationScope ? stationId : undefined, changes, reason);
      // تغيّر النطاق أثناء الحفظ: نتيجة نطاق سابق لا تُعرض تحت نطاق آخر (التحميل الجديد هو المرجع).
      if (scopeAtSave !== sequence.current) {
        success(t('settings.saved'));
        return;
      }
      // بعد الحفظ تُعاد القراءة من الخادم (القيمة الفعّالة بعد الوراثة هي المرجع)، لا نفترض أن ما أُرسل هو ما حُفظ.
      const start = toDraft(saved.policy, saved.overrides);
      setInitial(start);
      setDraft(start);
      if (!stationScope) setOrgPolicy(saved.policy);
      setReason('');
      success(t('settings.saved'));
    } catch (error) {
      const problem = classifyError(error, 'write');
      setFormError(problem === 'forbidden' ? t('settings.governanceRefused', { governance: GOVERNANCE, manage: MANAGE }) : serverMessage(error) ?? t('settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  function setField(field: PolicyField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  if (permissions === null) return <LoadingState variant="cards" rows={3} />;
  if (!canView || state === 'forbidden') return <ForbiddenState required={hasTankerView ? STATIONS_VIEW : TANKER_VIEW} />;
  if (state === 'gate_closed') return <GateClosedState />;
  if (state === 'error') return <ErrorState message={t('settings.loadFailed')} onRetry={() => void load(stationId)} />;
  if (state === 'loading' && stations.length === 0 && !stationScope) return <LoadingState variant="cards" rows={3} />;

  const editable = canGovern && state === 'ready';
  // الأنواع والحجم والعدد تكفيها `fuel_stations.manage`؛ الإلزام وبعد الإغلاق والإزالة حوكمية. الخادم يفرض الفرق — هذا لتعطيل ما لا يملكه المستخدم فقط.
  const basicEditable = canManage && state === 'ready';
  const canSave = state === 'ready' && dirty && (canGovern || (canManage && !touchesGovernance(changes)));
  const inheritLabel = (field: PolicyField) => {
    const orgDraft = toDraft(orgPolicy)[field];
    return t('settings.inherit', { value: valueLabel(field, orgDraft) });
  };
  function valueLabel(field: PolicyField, value: string): string {
    if (field === 'selectionRequired') return value === 'true' ? t('settings.selection.required') : t('settings.selection.optional');
    if (field === 'voucherScope') return t(`settings.voucher.scope.${value}`);
    if (field === 'attachmentRequired') return t(`settings.attachments.required.${value}`);
    if (field === 'attachmentTypes') return t(`settings.attachments.types.${value}`);
    if (field === 'attachmentMaxMb') return t('settings.attachments.size', { n: value });
    if (field === 'attachmentMaxCount') return t('settings.attachments.count', { n: value });
    if (field === 'attachmentAfterClose') return t(`settings.attachments.afterClose.${value}`);
    if (field === 'attachmentRemoval') return t(`settings.attachments.removal.${value}`);
    return t(`settings.overrun.policy.${value}`);
  }
  /** خيارات رقمية قصيرة + القيمة الحالية والموروثة إن لم تكن منها، فلا تضيع قيمة محفوظة خارج القائمة. */
  const numberOptions = (field: PolicyField, steps: readonly number[]) => {
    const present = new Set([...steps, Number(draft[field]), Number(toDraft(orgPolicy)[field])].filter((n) => Number.isInteger(n) && n > 0));
    return options(field, [...present].sort((a, b) => a - b).map(String));
  };
  const options = (field: PolicyField, values: readonly string[]) => (
    <>
      {stationScope ? <option value={INHERIT}>{inheritLabel(field)}</option> : null}
      {values.map((value) => <option key={value} value={value}>{valueLabel(field, value)}</option>)}
    </>
  );

  return (
    <div className="space-y-4">
      <PageHeader eyebrow={t('eyebrow')} title={t('settings.title')} description={t('settings.subtitle')} />
      {!canManage ? <p role="note" className="rounded-md border border-border bg-primary-soft px-3 py-2 text-sm text-text">{t('states.viewOnly', { permission: MANAGE })}</p> : null}
      {canManage && !canGovern ? <p role="note" className="rounded-md border border-border bg-primary-soft px-3 py-2 text-sm text-text">{t('settings.governanceNeeded', { governance: GOVERNANCE, manage: MANAGE })}</p> : null}

      <Card>
        <CardContent className="space-y-3 pt-4">
          <Field id="tanker-settings-scope" label={t('settings.scopeLabel')} hint={t('settings.scopeHint')}>
            <Select value={stationId} disabled={saving} onChange={(event) => { setScopeError(null); setStationId(event.target.value); }}>
              <option value="">{t('settings.orgScope')}</option>
              {stations.map((station) => <option key={station.id} value={station.id}>{station.name}{station.code ? ` (${station.code})` : ''}</option>)}
            </Select>
          </Field>
          {scopeError ? <p role="alert" className="text-sm text-negative">{scopeError}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('settings.selection.title')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="flex flex-wrap items-center gap-2 text-sm text-text">{t('settings.selection.owner')} <Badge tone="positive">{t('settings.selection.ownerAlways')}</Badge></p>
          <Field id="tanker-settings-selection" label={t('settings.selection.tanker')}>
            <Select value={draft.selectionRequired} disabled={!editable} onChange={(event) => setField('selectionRequired', event.target.value)}>
              {options('selectionRequired', ['false', 'true'])}
            </Select>
          </Field>
          <ul className="list-disc space-y-1 ps-5 text-sm text-muted">
            <li>{t('settings.selection.ruleOne')}</li>
            <li>{t('settings.selection.ruleMany')}</li>
            <li>{t('settings.selection.ruleNone')}</li>
            <li>{t('settings.selection.ruleSaved')}</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('settings.voucher.title')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Field id="tanker-settings-voucher" label={t('settings.voucher.scopeLabel')} hint={t('settings.voucher.scopeHint')}>
            <Select value={draft.voucherScope} disabled={!editable} onChange={(event) => setField('voucherScope', event.target.value)}>
              {options('voucherScope', VOUCHER_SCOPES)}
            </Select>
          </Field>
          <div className="rounded-md border border-border bg-primary-soft px-3 py-2">
            <p className="text-sm font-medium text-text">{t('settings.voucher.fixedTitle')}</p>
            <ul className="list-disc space-y-1 ps-5 text-sm text-muted">
              <li>{t('settings.voucher.fixedBlock')}</li>
              <li>{t('settings.voucher.fixedZeros')}</li>
              <li>{t('settings.voucher.fixedVoided')}</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('settings.overrun.title')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Field id="tanker-settings-overrun" label={t('settings.overrun.policyLabel')} hint={t('settings.overrun.hint')}>
            <Select value={draft.overrunPolicy} disabled={!editable} onChange={(event) => setField('overrunPolicy', event.target.value)}>
              {options('overrunPolicy', OVERRUN_POLICIES)}
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('settings.attachments.title')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted">{t('settings.attachments.hint')}</p>
          <Field id="tanker-settings-attachment-required" label={t('settings.attachments.requiredLabel')} hint={t('settings.attachments.requiredNote')}>
            <Select value={draft.attachmentRequired} disabled={!editable} onChange={(event) => setField('attachmentRequired', event.target.value)}>
              {options('attachmentRequired', ATTACHMENT_REQUIRED)}
            </Select>
          </Field>
          <Field id="tanker-settings-attachment-types" label={t('settings.attachments.typesLabel')}>
            <Select value={draft.attachmentTypes} disabled={!basicEditable} onChange={(event) => setField('attachmentTypes', event.target.value)}>
              {options('attachmentTypes', ATTACHMENT_TYPES)}
            </Select>
          </Field>
          <details className="rounded-md border border-border px-3 py-2" data-attachment-advanced="">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-text">{t('settings.attachments.advanced')}</summary>
            <div className="space-y-3 pb-2 pt-1">
              <p className="text-xs text-muted">{t('settings.attachments.advancedHint')}</p>
              <Field id="tanker-settings-attachment-size" label={t('settings.attachments.maxSizeLabel')}>
                <Select value={draft.attachmentMaxMb} disabled={!basicEditable} onChange={(event) => setField('attachmentMaxMb', event.target.value)}>
                  {numberOptions('attachmentMaxMb', [1, 2, 5, ATTACHMENT_HARD_MAX_MB])}
                </Select>
              </Field>
              <Field id="tanker-settings-attachment-count" label={t('settings.attachments.maxCountLabel')}>
                <Select value={draft.attachmentMaxCount} disabled={!basicEditable} onChange={(event) => setField('attachmentMaxCount', event.target.value)}>
                  {numberOptions('attachmentMaxCount', [1, 3, 5, 10, ATTACHMENT_HARD_MAX_COUNT])}
                </Select>
              </Field>
              <Field id="tanker-settings-attachment-after-close" label={t('settings.attachments.afterCloseLabel')}>
                <Select value={draft.attachmentAfterClose} disabled={!editable} onChange={(event) => setField('attachmentAfterClose', event.target.value)}>
                  {options('attachmentAfterClose', ATTACHMENT_AFTER_CLOSE)}
                </Select>
              </Field>
              <Field id="tanker-settings-attachment-removal" label={t('settings.attachments.removalLabel')} hint={t('settings.attachments.removalNote')}>
                <Select value={draft.attachmentRemoval} disabled={!editable} onChange={(event) => setField('attachmentRemoval', event.target.value)}>
                  {options('attachmentRemoval', ATTACHMENT_REMOVAL)}
                </Select>
              </Field>
              <p className="text-xs text-muted">{t('settings.attachments.limitsNote')}</p>
            </div>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <Field id="tanker-settings-reason" label={t('settings.reasonLabel')} hint={t('settings.reasonHint')}>
            <Input value={reason} maxLength={500} disabled={!basicEditable} onChange={(event) => setReason(event.target.value)} />
          </Field>
          {formError ? <p role="alert" className="text-sm text-negative">{formError}</p> : null}
          <Button type="button" className="max-md:h-11" disabled={!canSave || saving} onClick={() => void save()}>
            <Save className="h-4 w-4" aria-hidden="true" />{saving ? t('settings.saving') : t('settings.save')}
          </Button>
        </CardContent>
      </Card>

      <NozzleOperations key={stationId} stationId={stationId} canManage={canManage} />
    </div>
  );
}

/** عمليات الفوهات المسموحة للمحطة المختارة (القرار 6/7). كل فوهة تُحفظ على حدة؛ المجموعة الكاملة تُرسَل `null`؛ الفارغة غير مسموحة. */
function NozzleOperations({ stationId, canManage }: { stationId: string; canManage: boolean }) {
  const t = useTranslations('fuelTankers');
  const { success } = useToast();
  const [rows, setRows] = useState<NozzleRow[] | null>(null);
  const [selection, setSelection] = useState<Record<string, TankerOperation[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadFailed, setLoadFailed] = useState(false);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const mine = ++sequence.current;
    if (!stationId) { setRows(null); return; }
    setRows(null);
    setLoadFailed(false);
    try {
      const list = await listStationNozzles(stationId);
      // رد متأخر لمحطة سابقة (أو لطلب قديم) لا يكتب فوق المحطة المختارة الآن: وإلا حُفظ تعديل على فوهة محطة غير المعروضة.
      if (mine !== sequence.current) return;
      setRows(list);
      setSelection(Object.fromEntries(list.map((row) => [row.id, effectiveOperations(row.allowed_operations)])));
      setErrors({});
    } catch {
      if (mine === sequence.current) setLoadFailed(true);
    }
  }, [stationId]);

  useEffect(() => { void load(); return () => { sequence.current += 1; }; }, [load]);

  if (!stationId) {
    return <Card><CardHeader><CardTitle>{t('settings.nozzles.title')}</CardTitle></CardHeader><CardContent><p className="text-sm text-muted">{t('settings.nozzles.pickStation')}</p></CardContent></Card>;
  }

  function toggle(rowId: string, operation: TankerOperation) {
    setSelection((current) => {
      const now = current[rowId] ?? [];
      return { ...current, [rowId]: now.includes(operation) ? now.filter((o) => o !== operation) : [...now, operation] };
    });
  }

  async function save(row: NozzleRow) {
    const stored = toStoredOperations(selection[row.id] ?? []);
    if (stored === undefined || busy) return;
    setBusy(row.id);
    setErrors((current) => { const next = { ...current }; delete next[row.id]; return next; });
    try {
      const saved = await updateNozzleOperations(row.id, stored);
      setRows((current) => (current ?? []).map((r) => (r.id === row.id ? { ...r, allowed_operations: saved.allowed_operations } : r)));
      setSelection((current) => ({ ...current, [row.id]: effectiveOperations(saved.allowed_operations) }));
      success(t('settings.nozzles.saved'));
    } catch (error) {
      const problem = classifyError(error, 'write');
      setErrors((current) => ({ ...current, [row.id]: problem === 'forbidden' ? t('settings.nozzles.governanceRefused', { governance: GOVERNANCE, manage: MANAGE }) : serverMessage(error) ?? t('settings.saveFailed') }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>{t('settings.nozzles.title')}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted">{t('settings.nozzles.description')}</p>
        <p role="note" className="rounded-md border border-border bg-primary-soft px-3 py-2 text-sm text-text">{t('settings.nozzles.notEnforced')}</p>
        {loadFailed ? <ErrorState message={t('settings.nozzles.loadFailed')} onRetry={() => void load()} /> : null}
        {rows === null && !loadFailed ? <LoadingState variant="cards" rows={2} surface="bare" /> : null}
        {rows !== null && rows.length === 0 ? <p className="text-sm text-muted">{t('settings.nozzles.none')}</p> : null}
        <ul className="space-y-3">
          {(rows ?? []).map((row) => {
            const current = effectiveOperations(row.allowed_operations);
            const chosen = selection[row.id] ?? current;
            const stored = toStoredOperations(chosen);
            const changed = !sameOperations(chosen, current);
            const narrowing = changed && isNarrowing(current, chosen);
            return (
              <li key={row.id} data-nozzle={row.id} className="space-y-2 rounded-md border border-border p-3">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text">
                  <span>{t('settings.nozzles.label', { pump: row.pump_number ?? '—', nozzle: row.nozzle_number })}</span>
                  {row.product_name ? <Badge tone="neutral"><bdi>{row.product_name}</bdi></Badge> : null}
                </p>
                <fieldset className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-4" disabled={!canManage}>
                  <legend className="sr-only">{t('settings.nozzles.opsLegend')}</legend>
                  {TANKER_OPERATIONS.map((operation) => (
                    <label key={operation} className="flex min-h-11 items-center gap-2 text-sm text-text">
                      <input type="checkbox" className="h-5 w-5 accent-[var(--primary)]" checked={chosen.includes(operation)} onChange={() => toggle(row.id, operation)} />
                      {t(`settings.nozzles.ops.${operation}`)}
                    </label>
                  ))}
                </fieldset>
                {stored === undefined ? <p role="alert" className="text-xs text-negative">{t('settings.nozzles.needOne')}</p> : null}
                {narrowing ? <p className="text-xs text-muted">{t('settings.nozzles.narrowHint', { governance: GOVERNANCE })}</p> : null}
                {errors[row.id] ? <p role="alert" className="text-sm text-negative">{errors[row.id]}</p> : null}
                <Button type="button" size="sm" className="max-md:h-11" disabled={!canManage || !changed || stored === undefined || busy !== null} onClick={() => void save(row)}>
                  <Save className="h-3.5 w-3.5" aria-hidden="true" />{busy === row.id ? t('settings.saving') : t('settings.nozzles.save')}
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
