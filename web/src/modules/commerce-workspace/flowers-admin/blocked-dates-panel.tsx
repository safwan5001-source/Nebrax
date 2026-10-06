'use client';

import { useMemo, useState } from 'react';
import { CalendarOff, Plus, Trash2 } from 'lucide-react';
import { EmptyState, FormAlert } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import {
  blockedSignature,
  groupBlocked,
  sameBlocked,
  todayInZone,
  validateBlockedInput,
  weekdayOfIso,
  type BlockedInputError,
} from './blocked-dates';
import { ConfirmDialog } from './confirm-dialog';
import {
  MAX_BLOCKED_DATES,
  MAX_REASON_LENGTH,
  loadSchedule,
  saveBlockedDates,
  type BlockedDate,
  type BlockedMethod,
  type ScheduleDocument,
} from './delivery-schedule';
import { failureText } from './failure-text';
import { flowersAdminT, type FlowersAdminMessageKey } from './messages';
import { useUnsavedGuard } from './use-unsaved-guard';
import { weekdayName } from './weekday-names';

const INPUT_ERROR: Record<BlockedInputError, FlowersAdminMessageKey> = {
  date_required: 'blkErrDateRequired',
  date_invalid: 'blkErrDateInvalid',
  reason_too_long: 'blkErrReason',
  duplicate: 'blkErrDuplicate',
  overlaps_all: 'blkErrOverlap',
  limit: 'blkErrLimit',
};

/** «Tue 06/10/2026»: اسم اليوم من مكوّنات التاريخ نفسها + التاريخ بصيغة يوم/شهر/سنة بأرقام لاتينية. */
function describeDate(iso: string, locale: string | undefined): { weekday: string; text: string } {
  const [y, m, d] = iso.split('-');

  return { weekday: weekdayName(weekdayOfIso(iso), locale, 'long'), text: `${d}/${m}/${y}` };
}

/**
 * FLOWERS-H2-4 / ADR-19 — التواريخ المحجوبة (عطلات/ازدحام). التاريخ تقويمي بتوقيت المتجر، يُرسَل نصاً `Y-m-d`
 * كما اختاره التاجر ولا يُحوَّل بمنطقة المتصفّح. الخادم يستبدل المجموعة كاملةً، لذا كل فعل يرسل القائمة كاملة بعد
 * فحص أن نسخة الخادم لم تتغيّر منذ عرضناها. القادمة تُعرض أولاً؛ المنتهية مطويّة مع إزالة جماعية بتأكيد.
 */
export function BlockedDatesPanel({
  storeId,
  locale,
  document,
  onDocument,
}: {
  storeId: string;
  locale: string | undefined;
  document: ScheduleDocument;
  onDocument: (next: ScheduleDocument) => void;
}) {
  const t = useMemo(() => flowersAdminT(locale), [locale]);
  const { success: toastSuccess } = useToast();
  const rows = document.blockedDates;
  const zone = document.settings.timezone;
  const today = useMemo(() => todayInZone(zone), [zone]);
  const groups = useMemo(() => groupBlocked(rows, today), [rows, today]);

  const [date, setDate] = useState('');
  const [method, setMethod] = useState<BlockedMethod>('all');
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'error' | 'warning'; text: string } | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [confirmPast, setConfirmPast] = useState(false);

  // ما كُتب في نموذج الإضافة ولم يُحفظ يُسجَّل (تحذير المتصفّح + سؤال التنقّل/تبديل التبويب/المتجر).
  useUnsavedGuard(date !== '' || reason.trim() !== '');

  const inputError = submitted ? validateBlockedInput({ date, method, reason }, rows) : null;
  const methodLabel = (m: BlockedMethod) => (m === 'all' ? t('blkMethodAll') : m === 'delivery' ? t('winMethodDelivery') : t('winMethodPickup'));

  async function persist(next: BlockedDate[]): Promise<string | null> {
    // الاستبدال كامل ⇒ التحقق من «لم يتغيّر شيء» داخل قفل الخادم (`expected_revision` ⇒ 409). الفحص المسبق احتياطٌ لخادمٍ
    // بلا بصمة، وفشل قراءته يُوقف الكتابة بدل أن يكتب من نسخة قد تكون قديمة.
    const revision = document.blockedRevision ?? null;
    if (revision === null) {
      const fresh = await loadSchedule(storeId);
      if (!fresh.ok) return failureText(fresh, t);
      if (blockedSignature(fresh.data.blockedDates) !== blockedSignature(rows)) {
        onDocument(fresh.data);
        return t('blkStale');
      }
    }
    const saved = await saveBlockedDates(storeId, next, revision);
    if (!saved.ok) {
      if (saved.kind === 'conflict') {
        const fresh = await loadSchedule(storeId);
        if (fresh.ok) onDocument(fresh.data);

        return t('blkStale');
      }

      return failureText(saved, t);
    }
    onDocument(saved.data);

    return null;
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setSubmitted(true);
    if (validateBlockedInput({ date, method, reason }, rows) !== null) return;
    setBusy(true);
    setNotice(null);
    const failure = await persist([...rows, { date, method, reason: reason.trim() === '' ? null : reason.trim() }]);
    setBusy(false);
    if (failure) {
      setNotice({ tone: failure === t('blkStale') ? 'warning' : 'error', text: failure });
      return;
    }
    toastSuccess(t('blkAdded'));
    setDate('');
    setReason('');
    setSubmitted(false);
  }

  async function remove(target: BlockedDate) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const failure = await persist(rows.filter((row) => !sameBlocked(row, target)));
    setBusy(false);
    if (failure) setNotice({ tone: failure === t('blkStale') ? 'warning' : 'error', text: failure });
    else toastSuccess(t('blkRemoved'));
  }

  async function removePast(): Promise<string | null> {
    const failure = await persist(groups.upcoming);
    if (failure) return failure;
    toastSuccess(t('blkRemoved'));
    setConfirmPast(false);

    return null;
  }

  function renderRow(row: BlockedDate, dim: boolean) {
    const described = describeDate(row.date, locale);

    return (
      <li key={`${row.date}|${row.method}`} className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm ${dim ? 'text-muted' : ''}`} data-blocked-row={`${row.date}|${row.method}`}>
        <div className="min-w-0 space-y-0.5">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className={dim ? '' : 'font-medium text-text'}>{described.weekday}</span>
            <bdi className="num">{described.text}</bdi>
            <span className="text-xs text-muted">· {methodLabel(row.method)}</span>
          </p>
          {row.reason ? <p className="truncate text-xs text-muted">{row.reason}</p> : null}
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label={`${t('blkRemove')}: ${described.text}`} disabled={busy} onClick={() => void remove(row)}>
          <Trash2 className="h-4 w-4 text-negative" aria-hidden="true" />
        </Button>
      </li>
    );
  }

  return (
    <section aria-label={t('blkTab')} className="max-w-3xl space-y-4" data-blocked-panel>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-text">{t('blkTab')}</h2>
        <p className="text-xs leading-5 text-muted">{t('blkIntro', { zone })}</p>
      </div>

      <form onSubmit={add} noValidate className="space-y-3 rounded border border-border bg-surface p-4" aria-label={t('blkAddTitle')}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-1.5">
            <Label htmlFor="blk-date">{t('blkDate')}</Label>
            <Input
              id="blk-date"
              type="date"
              dir="ltr"
              value={date}
              disabled={busy}
              aria-invalid={inputError === 'date_required' || inputError === 'date_invalid'}
              aria-describedby={inputError ? 'blk-error' : undefined}
              onChange={(e) => {
                setDate(e.target.value);
                setNotice(null);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="blk-method">{t('blkMethod')}</Label>
            <Select id="blk-method" value={method} disabled={busy} onChange={(e) => setMethod(e.target.value as BlockedMethod)}>
              <option value="all">{t('blkMethodAll')}</option>
              <option value="delivery">{t('winMethodDelivery')}</option>
              <option value="pickup">{t('winMethodPickup')}</option>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="blk-reason">{t('blkReason')}</Label>
          <Input
            id="blk-reason"
            value={reason}
            maxLength={MAX_REASON_LENGTH + 20}
            placeholder={t('blkReasonPlaceholder')}
            disabled={busy}
            aria-invalid={inputError === 'reason_too_long'}
            aria-describedby={inputError ? 'blk-error' : undefined}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        {inputError ? (
          <p id="blk-error" role="alert" className="text-xs text-negative">
            {t(INPUT_ERROR[inputError], { max: MAX_BLOCKED_DATES })}
          </p>
        ) : null}
        <Button type="submit" disabled={busy} className="w-full sm:w-auto">
          <Plus className="h-4 w-4" aria-hidden="true" />
          {busy ? t('saving') : t('blkAdd')}
        </Button>
      </form>

      {notice ? <FormAlert tone={notice.tone}>{notice.text}</FormAlert> : null}

      {rows.length === 0 ? (
        <EmptyState icon={CalendarOff} title={t('blkEmptyTitle')} description={t('blkEmptyDescription')} />
      ) : (
        <>
          {groups.upcoming.length > 0 ? (
            <div className="space-y-2" data-blocked-upcoming>
              <h3 className="text-xs font-semibold text-muted">{t('blkUpcoming', { n: groups.upcoming.length })}</h3>
              <ul className="divide-y divide-border rounded border border-border bg-surface">{groups.upcoming.map((row) => renderRow(row, false))}</ul>
            </div>
          ) : (
            <p className="text-xs text-muted">{t('blkNoUpcoming')}</p>
          )}

          {groups.past.length > 0 ? (
            <div className="space-y-2" data-blocked-past>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  aria-expanded={showPast}
                  aria-controls="blk-past-list"
                  className="text-xs font-semibold text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  onClick={() => setShowPast((v) => !v)}
                >
                  {t('blkPast', { n: groups.past.length })}
                </button>
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmPast(true)}>
                  {t('blkClearPast')}
                </Button>
              </div>
              {showPast ? (
                <ul id="blk-past-list" className="divide-y divide-border rounded border border-border bg-surface">
                  {groups.past.map((row) => renderRow(row, true))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {confirmPast ? (
        <ConfirmDialog
          title={t('blkClearPastTitle')}
          message={t('blkClearPastMessage', { n: groups.past.length })}
          confirmLabel={t('blkClearPast')}
          cancelLabel={t('cancel')}
          busyLabel={t('saving')}
          onClose={() => setConfirmPast(false)}
          onConfirm={removePast}
        />
      ) : null}
    </section>
  );
}
