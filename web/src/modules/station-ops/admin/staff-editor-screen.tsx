'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CheckCircle2, CircleAlert, LockKeyhole, RefreshCw, TriangleAlert } from 'lucide-react';
import { PERMISSION_RISK } from '@/modules/roles/risk';
import { cn } from '@/lib/utils';
import { useStationOps } from '../context';
import { PageMasthead, ScreenBody } from '../masthead';
import { StationOpsError, isAbort, toStationOpsError } from '../read-client';
import { EmptyState, ErrorState, LoadingBlock } from '../state-views';
import { ActionBar, ConfirmDialog, PrimaryButton, SecondaryButton } from '../write-ui';
import { adminGet, isValidStaffId, saveStaff, staffPath, type StaffSaveResult } from './admin-client';
import { STAFF_PERMISSION, useStaffMember, useTemplates } from './data';
import {
  EMPTY_INTENT, addBlockReason, applyTemplatePermissions, buildUpdateBody, contextOf, effectivePermissions, effectiveStations, groupPermissions,
  isDirty, matchTemplate, rebaseIntent, selectAllDelegable, togglePermission, toggleStation, type EditContext, type EditIntent,
} from './editing';
import { usePermissionLabel } from './labels';
import { MANAGE_BASE } from './manage-screen';
import { staffOneResponse, type StaffView, type TemplatesPayload } from './schemas';
import { templateLabelKey } from './staff-list-screen';
import { StationPinSection } from '../pin/pin-section';
import { Badge, SwitchRow } from './ui';

type Notice =
  | { kind: 'saved' }
  | { kind: 'conflict'; refreshed: boolean }
  | { kind: 'changed' }
  | { kind: 'forbidden'; message: string | null }
  | { kind: 'not_found' }
  | { kind: 'validation'; message: string | null }
  | { kind: 'unknown' }
  | { kind: 'offline' }
  | { kind: 'other'; message: string | null };

function noticeFor(result: StaffSaveResult): Notice | null {
  switch (result.kind) {
    case 'ok': return { kind: 'saved' };
    case 'unverified': return { kind: 'unknown' };
    case 'unknown': return { kind: 'unknown' };
    case 'not_sent': return result.reason === 'offline' ? { kind: 'offline' } : { kind: 'other', message: null };
    case 'rejected':
      if (result.code === 'revision_conflict') return { kind: 'conflict', refreshed: false };
      if (result.code === 'forbidden') return { kind: 'forbidden', message: result.serverMessage };
      if (result.code === 'not_found') return { kind: 'not_found' };
      if (result.code === 'validation') return { kind: 'validation', message: result.serverMessage };
      return { kind: 'other', message: result.serverMessage };
  }
}

function NoticeBar({ notice, busy, onRebase, onDiscard, onCheck }: {
  notice: Notice | null;
  busy: boolean;
  onRebase: () => void;
  onDiscard: () => void;
  onCheck: () => void;
}) {
  const t = useTranslations('stationOps');
  if (!notice) return null;
  const ok = notice.kind === 'saved';
  const Icon = ok ? CheckCircle2 : notice.kind === 'conflict' || notice.kind === 'changed' || notice.kind === 'unknown' || notice.kind === 'offline' ? TriangleAlert : CircleAlert;
  const tone = ok ? 'bg-[color:var(--fo-positive-tint)] text-positive' : notice.kind === 'conflict' || notice.kind === 'changed' || notice.kind === 'unknown' || notice.kind === 'offline' ? 'bg-[color:var(--fo-warning-tint)] text-warning' : 'bg-[color:var(--fo-negative-tint)] text-negative';
  const message = 'message' in notice && notice.message ? notice.message : null;
  const button = 'inline-flex min-h-11 items-center gap-2 rounded-lg border border-current bg-surface px-3 text-sm font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60';

  return (
    <div role={ok ? 'status' : 'alert'} data-notice={notice.kind} className={`flex items-start gap-3 rounded-[14px] border border-border p-3.5 text-sm leading-6 ${tone}`}>
      <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.9} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{t(`manage.editor.notice.${notice.kind}.title`)}</p>
        <p className="mt-0.5">{t(`manage.editor.notice.${notice.kind}.body`)}</p>
        {message ? <p className="mt-1 break-words text-xs opacity-90">{t('manage.editor.notice.serverSays', { message })}</p> : null}
        {notice.kind === 'conflict' || notice.kind === 'changed' ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={onRebase} disabled={busy} className={button}><RefreshCw aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />{t('manage.editor.notice.rebase')}</button>
            <button type="button" onClick={onDiscard} disabled={busy} className={button}>{t('manage.editor.notice.discard')}</button>
          </div>
        ) : null}
        {notice.kind === 'unknown' ? (
          <div className="mt-2"><button type="button" onClick={onCheck} disabled={busy} className={button}><RefreshCw aria-hidden="true" className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} strokeWidth={1.8} />{busy ? t('manage.editor.notice.checking') : t('manage.editor.notice.check')}</button></div>
        ) : null}
        {notice.kind === 'forbidden' || notice.kind === 'validation' || notice.kind === 'other' || notice.kind === 'offline' ? (
          <p className="mt-1 text-xs opacity-90">{t('manage.editor.notice.editsKept')}</p>
        ) : null}
        {notice.kind === 'not_found' ? <div className="mt-2"><Link href={`${MANAGE_BASE}/staff`} className={button}>{t('manage.editor.notice.backToList')}</Link></div> : null}
      </div>
    </div>
  );
}

function TemplatePicker({ templates, current, disabled, onPick }: { templates: TemplatesPayload; current: string; disabled: boolean; onPick: (key: string) => void }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="text-sm text-muted">{t('manage.editor.templateHint')}</legend>
      <div role="radiogroup" aria-label={t('manage.editor.templateTitle')} className="mt-3 grid grid-cols-1 gap-2.5">
        {templates.templates.map((template) => {
          const selected = current === template.key;
          const blocked = !template.assignable;
          return (
            <button
              key={template.key}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled || blocked}
              onClick={() => onPick(template.key)}
              className={cn(
                'flex min-h-[64px] items-start gap-3 rounded-[13px] border p-3.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60',
                selected ? 'border-primary bg-primary-soft' : 'border-[color:var(--fo-control)] bg-surface',
              )}
            >
              <span aria-hidden="true" className={cn('mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2', selected ? 'border-primary' : 'border-[color:var(--fo-control)]')}>
                {selected ? <span className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-text">{locale === 'ar' ? template.label_ar : template.label_en}</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted">{t(`manage.editor.templateDesc.${template.key}`)} · {t('manage.staff.permCount', { count: template.permissions.length })}</span>
                {blocked ? <span className="mt-1 flex items-center gap-1.5 text-xs text-warning"><LockKeyhole aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.8} />{t('manage.editor.templateBlocked')}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
      {current === 'custom' ? <p className="mt-2 text-sm text-muted">{t('manage.editor.customNote')}</p> : null}
      {current === 'none' ? <p className="mt-2 text-sm text-muted">{t('manage.editor.noneNote')}</p> : null}
    </fieldset>
  );
}

function PermissionGroups({ templates, base, intent, ctx, disabled, onToggle, onToggleGroup }: {
  templates: TemplatesPayload;
  base: StaffView;
  intent: EditIntent;
  ctx: EditContext;
  disabled: boolean;
  onToggle: (key: string) => void;
  onToggleGroup: (keys: string[], on: boolean) => void;
}) {
  const t = useTranslations('stationOps');
  const label = usePermissionLabel();
  const held = new Set(effectivePermissions(base, intent));
  const groups = groupPermissions(templates.catalog);

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const keys = group.keys;
        const heldCount = keys.filter((key) => held.has(key)).length;
        const toggleable = keys.filter((key) => addBlockReason(key, ctx) === null && !ctx.reserved.has(key));
        const allOn = toggleable.length > 0 && toggleable.every((key) => held.has(key));
        const changed = keys.some((key) => intent.permAdd.has(key) || intent.permRemove.has(key));
        return (
          <details key={group.id} open={changed || undefined} className="rounded-[13px] border border-border bg-surface">
            <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <span className="text-[15px] font-semibold text-text">{t(`manage.group.${group.id}`)}</span>
              <span className="flex items-center gap-2">
                {changed ? <Badge tone="info">{t('manage.editor.changed')}</Badge> : null}
                <span className="num text-sm text-muted">{heldCount}/{keys.length}</span>
              </span>
            </summary>
            <div className="divide-y divide-border px-4 pb-2">
              {toggleable.length > 1 ? (
                <div className="py-2">
                  <SecondaryButton disabled={disabled} onClick={() => onToggleGroup(toggleable, !allOn)}>{allOn ? t('manage.editor.clearGroup') : t('manage.editor.selectGroup')}</SecondaryButton>
                </div>
              ) : null}
              {keys.map((key) => {
                const on = held.has(key);
                const block = on ? null : addBlockReason(key, ctx);
                const risk = PERMISSION_RISK[key];
                return (
                  <SwitchRow
                    key={key}
                    id={`perm-${key}`}
                    label={label(key)}
                    checked={on}
                    disabled={disabled}
                    locked={block === 'reserved' ? t('manage.editor.lockedReserved') : block === 'not_delegable' ? t('manage.editor.lockedBeyond') : null}
                    badge={risk === 'access' || risk === 'financial' ? <Badge tone="warning">{t('manage.editor.sensitive')}</Badge> : ctx.reserved.has(key) ? <Badge tone="warning">{t('manage.editor.reservedBadge')}</Badge> : null}
                    onChange={() => onToggle(key)}
                    note={on && base.fuel_permissions.includes(key) === false ? <p className="text-xs text-primary">{t('manage.editor.willAdd')}</p> : !on && base.fuel_permissions.includes(key) ? <p className="text-xs text-warning">{t('manage.editor.willRemove')}</p> : null}
                  />
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function StationPicker({ base, intent, disabled, onToggle }: { base: StaffView; intent: EditIntent; disabled: boolean; onToggle: (id: string) => void }) {
  const t = useTranslations('stationOps');
  const { stations } = useStationOps();
  const chosen = new Set(effectiveStations(base, intent));
  if (stations.status !== 'success') return stations.status === 'loading' ? <LoadingBlock rows={2} /> : null;
  const visibleIds = new Set(stations.data.map((station) => station.id));
  const hidden = [...chosen].filter((id) => !visibleIds.has(id)).length;

  return (
    <div className="space-y-3">
      <p className="rounded-[12px] bg-[color:var(--fo-warning-tint)] p-3 text-sm leading-6 text-warning">{t('manage.stations.noAssignmentNote')}</p>
      {stations.data.length === 0 ? <EmptyState title={t('manage.stations.none')} body={t('manage.stations.noneBody')} /> : null}
      <ul className="space-y-2">
        {stations.data.map((station) => {
          const on = chosen.has(station.id);
          const changed = on !== base.station_ids.includes(station.id);
          return (
            <li key={station.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                disabled={disabled}
                onClick={() => onToggle(station.id)}
                className={cn('flex min-h-[56px] w-full items-center gap-3 rounded-[12px] border px-3.5 py-2 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60', on ? 'border-primary bg-primary-soft' : 'border-[color:var(--fo-control)] bg-surface')}
              >
                <span aria-hidden="true" className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 text-xs font-bold', on ? 'border-primary bg-primary text-primary-foreground' : 'border-[color:var(--fo-control)]')}>{on ? '✓' : ''}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-text">{station.name}</span>
                  <span className="block text-xs text-muted">{station.code}{station.status !== 'active' ? ` · ${t('stationInactive')}` : ''}</span>
                </span>
                {changed ? <Badge tone="info">{t('manage.editor.changed')}</Badge> : null}
              </button>
            </li>
          );
        })}
      </ul>
      {hidden > 0 ? <p className="text-sm text-muted">{t('manage.stations.hiddenKept', { count: hidden })}</p> : null}
      {chosen.size === 0 ? <p role="status" className="flex items-start gap-2 text-sm leading-6 text-warning"><TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} />{t('manage.stations.emptyWarning')}</p> : null}
      <p className="text-xs leading-5 text-muted">{t('manage.stations.intersectionNote')}</p>
    </div>
  );
}

function ReviewDialog({ open, base, intent, reason, setReason, saving, onCancel, onConfirm }: {
  open: boolean; base: StaffView; intent: EditIntent; reason: string; setReason: (value: string) => void; saving: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const t = useTranslations('stationOps');
  const label = usePermissionLabel();
  const { stations } = useStationOps();
  const names = stations.status === 'success' ? new Map(stations.data.map((station) => [station.id, station.name])) : new Map<string, string>();
  const stationName = (id: string) => names.get(id) ?? t('manage.stations.other');
  const after = effectiveStations(base, intent);
  const reservedAdded = [...intent.permAdd].filter((key) => key === 'fuel.governance.manage' || key === 'fuel.staff.manage');
  const section = (title: string, keys: string[], tone: 'plus' | 'minus', render: (key: string) => string) => keys.length === 0 ? null : (
    <div>
      <p className="text-sm font-semibold text-text">{title}</p>
      <ul className="mt-1 space-y-1">
        {keys.sort().map((key) => (
          <li key={key} className={cn('flex items-start gap-2 text-sm leading-6', tone === 'plus' ? 'text-positive' : 'text-negative')}>
            <span aria-hidden="true" className="num w-4 shrink-0 text-center font-bold">{tone === 'plus' ? '+' : '−'}</span>
            <span className="min-w-0 break-words text-text">{render(key)}</span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <ConfirmDialog open={open} title={t('manage.review.title', { name: base.user.name })} onClose={onCancel} busy={saving}>
      <div className="space-y-4">
        <p className="text-sm leading-6 text-muted">{t('manage.review.intro')}</p>
        {section(t('manage.review.permAdded'), [...intent.permAdd], 'plus', label)}
        {section(t('manage.review.permRemoved'), [...intent.permRemove], 'minus', label)}
        {section(t('manage.review.stationsAdded'), [...intent.stationAdd], 'plus', stationName)}
        {section(t('manage.review.stationsRemoved'), [...intent.stationRemove], 'minus', stationName)}
        {reservedAdded.length > 0 ? <p role="alert" className="rounded-[12px] bg-[color:var(--fo-warning-tint)] p-3 text-sm leading-6 text-warning">{t('manage.review.reservedWarning')}</p> : null}
        {after.length === 0 ? <p role="alert" className="rounded-[12px] bg-[color:var(--fo-warning-tint)] p-3 text-sm leading-6 text-warning">{t('manage.review.noStationsWarning')}</p> : null}
        <div>
          <label htmlFor="mg-reason" className="block text-sm font-medium text-text">{t('manage.review.reason')}</label>
          <textarea id="mg-reason" value={reason} maxLength={500} rows={2} disabled={saving} onChange={(event) => setReason(event.target.value)} className="mt-1.5 w-full rounded-[11px] border border-[color:var(--fo-control)] bg-surface p-3 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
          <p className="mt-1 text-xs text-muted">{t('manage.review.reasonHint')}</p>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <SecondaryButton onClick={onCancel} disabled={saving}>{t('manage.review.back')}</SecondaryButton>
          <PrimaryButton onClick={onConfirm} disabled={saving} aria-busy={saving}>{saving ? t('manage.review.saving') : t('manage.review.confirm')}</PrimaryButton>
        </div>
      </div>
    </ConfirmDialog>
  );
}

/** المحرر بعد اكتمال التحميل: `initial` هو الأساس المقروء، ولا يُكتب شيء قبل «تأكيد الحفظ» الصريح. */
function Editor({ initial, templates }: { initial: StaffView; templates: TemplatesPayload }) {
  const t = useTranslations('stationOps');
  const { viewer } = useStationOps();
  const [base, setBase] = useState<StaffView>(initial);
  const [intent, setIntent] = useState<EditIntent>(EMPTY_INTENT);
  const [reviewing, setReviewing] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const inFlight = useRef(false);
  const pendingLatest = useRef<StaffView | null>(null);
  const ctx = contextOf(templates);
  const isSelf = base.user.id === viewer.id;
  const locked = isSelf || notice?.kind === 'not_found';
  const dirty = isDirty(intent);
  const changes = intent.permAdd.size + intent.permRemove.size + intent.stationAdd.size + intent.stationRemove.size;
  const current = matchTemplate(templates, effectivePermissions(base, intent));

  // تنبيه مغادرة الصفحة بتعديلات غير محفوظة (لا كتابة هنا — مجرد حماية).
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const fetchLatest = useCallback(async (): Promise<StaffView | null> => {
    try {
      return (await adminGet(staffPath(base.user.id), staffOneResponse)).data;
    } catch (error) {
      if (isAbort(error)) return null;
      if (toStationOpsError(error).kind === 'not_found') setNotice({ kind: 'not_found' });
      return null;
    }
  }, [base.user.id]);

  const onPickTemplate = (key: string) => {
    const template = templates.templates.find((row) => row.key === key);
    if (template && template.assignable) { setIntent((value) => applyTemplatePermissions(base, value, template.permissions)); setNotice(null); }
  };

  const confirmSave = async () => {
    if (inFlight.current) return; // قفل إرسال مكرر
    inFlight.current = true;
    setSaving(true);
    try {
      const result = await saveStaff(base.user.id, buildUpdateBody(base, intent, reason));
      const next = noticeFor(result);
      setReviewing(false);
      if (result.kind === 'ok') {
        setBase(result.staff);
        setIntent(EMPTY_INTENT);
        setReason('');
        setNotice({ kind: 'saved' });
        return;
      }
      setNotice(next);
      if (next?.kind === 'conflict') {
        const latest = await fetchLatest();
        if (latest) setNotice({ kind: 'conflict', refreshed: true });
        // الأساس الجديد يُحمَّل عند اختيار المستخدم (إعادة تطبيق/تجاهل) كي لا تتغير الشاشة تحت يده.
        pendingLatest.current = latest;
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const rebase = async () => {
    setChecking(true);
    const latest = pendingLatest.current ?? (await fetchLatest());
    setChecking(false);
    if (!latest) return;
    pendingLatest.current = null;
    setBase(latest);
    setIntent((value) => rebaseIntent(latest, value));
    setNotice(null);
  };
  const discard = async () => {
    setChecking(true);
    const latest = pendingLatest.current ?? (await fetchLatest());
    setChecking(false);
    if (!latest) return;
    pendingLatest.current = null;
    setBase(latest);
    setIntent(EMPTY_INTENT);
    setNotice(null);
  };
  /** نتيجة غير مؤكدة: لا نعيد الكتابة؛ نقرأ الحالة ونقارن بما كنا نريده. */
  const check = async () => {
    setChecking(true);
    const wantedPerms = effectivePermissions(base, intent).join('|');
    const wantedStations = effectiveStations(base, intent).join('|');
    const latest = await fetchLatest();
    setChecking(false);
    if (!latest) return;
    const same = [...latest.fuel_permissions].sort().join('|') === wantedPerms && [...latest.station_ids].sort().join('|') === wantedStations;
    setBase(latest);
    if (same) { setIntent(EMPTY_INTENT); setNotice({ kind: 'saved' }); }
    else { setIntent((value) => rebaseIntent(latest, value)); setNotice({ kind: 'changed' }); }
  };

  const heading = (id: string, title: string, hint?: string) => (
    <div className="mb-3">
      <h2 id={id} className="text-base font-semibold text-text">{title}</h2>
      {hint ? <p className="mt-1 text-sm leading-6 text-muted">{hint}</p> : null}
    </div>
  );

  return (
    <>
      <PageMasthead title={base.user.name} subtitle={t('manage.editor.subtitle')} backHref={`${MANAGE_BASE}/staff`} backLabel={t('manage.staff.title')} />
      <ScreenBody>
        <section className="flex flex-wrap items-center gap-2 rounded-[14px] border border-border bg-surface p-4">
          <Badge tone={base.user.is_active ? 'positive' : 'negative'}>{base.user.is_active ? t('manage.editor.active') : t('manage.staff.inactive')}</Badge>
          <Badge tone="info">{t(templateLabelKey(base.template))}</Badge>
          <Badge tone="neutral">{t('manage.staff.permCount', { count: base.fuel_permissions.length })}</Badge>
          {base.user.email ? <span dir="ltr" className="min-w-0 truncate text-start text-xs text-muted">{base.user.email}</span> : null}
        </section>

        {isSelf ? <p role="status" className="rounded-[12px] bg-[color:var(--fo-warning-tint)] p-3 text-sm leading-6 text-warning">{t('manage.editor.selfLocked')}</p> : null}

        <StationPinSection staff={base} isSelf={isSelf} />

        <NoticeBar notice={notice} busy={checking} onRebase={() => void rebase()} onDiscard={() => void discard()} onCheck={() => void check()} />

        <section aria-labelledby="mg-tpl-h">
          {heading('mg-tpl-h', t('manage.editor.templateTitle'))}
          <TemplatePicker templates={templates} current={current} disabled={locked} onPick={onPickTemplate} />
        </section>

        <section aria-labelledby="mg-perm-h">
          {heading('mg-perm-h', t('manage.editor.permissionsTitle'), t('manage.editor.permissionsHint'))}
          <div className="mb-3 grid grid-cols-2 gap-2.5">
            <SecondaryButton disabled={locked} onClick={() => { setIntent((value) => selectAllDelegable(base, value, ctx)); setNotice(null); }}>{t('manage.editor.selectAll')}</SecondaryButton>
            <SecondaryButton disabled={locked || !dirty} onClick={() => setIntent(EMPTY_INTENT)}>{t('manage.editor.reset')}</SecondaryButton>
          </div>
          <p className="mb-3 text-xs leading-5 text-muted">{t('manage.editor.selectAllNote')}</p>
          <PermissionGroups
            templates={templates}
            base={base}
            intent={intent}
            ctx={ctx}
            disabled={locked}
            onToggle={(key) => { setIntent((value) => togglePermission(base, value, key, ctx)); setNotice(null); }}
            onToggleGroup={(keys, on) => {
              setIntent((value) => keys.reduce((acc, key) => (effectivePermissions(base, acc).includes(key) === on ? acc : togglePermission(base, acc, key, ctx)), value));
              setNotice(null);
            }}
          />
          <p className="mt-3 text-xs leading-5 text-muted">{t('manage.editor.reservedNote')}</p>
        </section>

        <section aria-labelledby="mg-st-h">
          {heading('mg-st-h', t('manage.stations.title'), t('manage.stations.hint'))}
          <StationPicker base={base} intent={intent} disabled={locked} onToggle={(id) => { setIntent((value) => toggleStation(base, value, id)); setNotice(null); }} />
        </section>

        <ActionBar>
          <div className="grid grid-cols-2 gap-2.5">
            <SecondaryButton disabled={!dirty || saving} onClick={() => { setIntent(EMPTY_INTENT); setNotice(null); }}>{t('manage.editor.cancelEdits')}</SecondaryButton>
            <PrimaryButton disabled={!dirty || saving || locked} onClick={() => setReviewing(true)}>{dirty ? t('manage.editor.review', { count: changes }) : t('manage.editor.noChanges')}</PrimaryButton>
          </div>
        </ActionBar>
      </ScreenBody>

      <ReviewDialog open={reviewing} base={base} intent={intent} reason={reason} setReason={setReason} saving={saving} onCancel={() => setReviewing(false)} onConfirm={() => void confirmSave()} />
    </>
  );
}

export function StaffEditorScreen({ id }: { id: string }) {
  const t = useTranslations('stationOps');
  const { can } = useStationOps();
  const member = useStaffMember(id);
  const templates = useTemplates();

  if (!can(STAFF_PERMISSION)) return <><PageMasthead title={t('manage.staff.title')} backHref={MANAGE_BASE} backLabel={t('manage.back')} /><ScreenBody><ErrorState error={new StationOpsError('forbidden', 403)} /></ScreenBody></>;
  const head = <PageMasthead title={t('manage.staff.title')} backHref={`${MANAGE_BASE}/staff`} backLabel={t('manage.staff.title')} />;
  if (!isValidStaffId(id)) return <>{head}<ScreenBody><ErrorState error={new StationOpsError('not_found', 404)} /></ScreenBody></>;
  if (member.state.status === 'error') return <>{head}<ScreenBody><ErrorState error={member.state.error} onRetry={member.reload} /></ScreenBody></>;
  if (templates.state.status === 'error') return <>{head}<ScreenBody><ErrorState error={templates.state.error} onRetry={templates.reload} /></ScreenBody></>;
  if (member.state.status !== 'success' || templates.state.status !== 'success') return <>{head}<ScreenBody><LoadingBlock rows={4} /></ScreenBody></>;

  return <Editor key={member.state.data.user.id} initial={member.state.data} templates={templates.state.data} />;
}
