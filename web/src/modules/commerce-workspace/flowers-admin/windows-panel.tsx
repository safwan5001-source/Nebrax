'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CalendarClock, Pencil, Plus, Trash2 } from 'lucide-react';
import { EmptyState, FormAlert } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from './confirm-dialog';
import {
  DELIVERY_METHODS,
  MAX_SLOTS,
  loadSchedule,
  saveSlots,
  type DeliveryMethod,
  type DeliverySlot,
  type ScheduleDocument,
} from './delivery-schedule';
import { failureText } from './failure-text';
import { flowersAdminT } from './messages';
import { loadShippingZones } from './shipping-zones';
import { SlotDialog, type ZoneState } from './slot-dialog';
import { canAddSlot, draftToSlot, emptySlotDraft, moveWithinMethod, slotToDraft, slotsSignature, type SlotDraft } from './slot-editor';
import { summarizeWeekdays } from './weekday-names';

type DialogState = { kind: 'add'; method: DeliveryMethod } | { kind: 'edit'; index: number } | null;

const GRID = 'md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.1fr)_auto] md:items-center md:gap-4';

/**
 * FLOWERS-H2-3 / ADR-19 — فترات التسليم والسعة. الخادم يستبدل المجموعة كاملةً بالمعرّف، لذا كل فعل (إضافة،
 * تعديل، تفعيل، ترتيب، حذف) يرسل القائمة كاملةً مبنيةً من آخر مستند محفوظ، ويُعاد عرض ما أعاده الخادم.
 * قبل أي كتابة نقارن نوافذ الخادم الحالية بما نعرضه: إن تغيّرت (مدير آخر) نحدّث العرض ونُوقف الفعل بدل أن
 * نحذف بصمت ما أضافه غيرنا. لا حساب سعة/توفّر هنا، والحذف آمن: الطلبات القائمة تحتفظ بلقطة موعدها.
 */
export function WindowsPanel({
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
  const [dialog, setDialog] = useState<DialogState>(null);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'error' | 'warning'; text: string } | null>(null);
  const [zones, setZones] = useState<ZoneState | null>(null);
  const slots = document.slots;

  function refreshZones() {
    void loadShippingZones().then((result) => setZones(result.ok ? { kind: 'ready', zones: result.data } : (current) => (current?.kind === 'ready' ? current : { kind: 'failed' })));
  }
  // المناطق تُقرأ عند الفتح (لعرض وجهة كل نافذة) وتُجدَّد عند كل فتح حوار، فلا يبقى خيارٌ عُطّل بعد أول قراءة.
  useEffect(refreshZones, [storeId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function persist(next: DeliverySlot[]): Promise<string | null> {
    // الاستبدال كامل، فالتحقق من «لم يتغيّر شيء» يجب أن يتم **داخل قفل الخادم** (بصمة `expected_revision` ⇒ 409): قراءةٌ
    // مسبقة ثم كتابة لا تمنع سباق مديرَين. الفحص المسبق أدناه احتياطٌ فقط لخادمٍ لا يُعيد البصمة، وفشله يُوقف الكتابة.
    const revision = document.slotsRevision ?? null;
    if (revision === null) {
      const fresh = await loadSchedule(storeId);
      if (!fresh.ok) return failureText(fresh, t);
      if (slotsSignature(fresh.data.slots) !== slotsSignature(slots)) {
        onDocument(fresh.data);
        return t('winStale');
      }
    }
    const saved = await saveSlots(storeId, next, revision);
    if (!saved.ok) {
      if (saved.kind === 'conflict') {
        const fresh = await loadSchedule(storeId);
        if (fresh.ok) onDocument(fresh.data);

        return t('winStale');
      }

      return failureText(saved, t);
    }
    onDocument(saved.data);

    return null;
  }

  async function runInline(key: string, next: DeliverySlot[], successText?: string) {
    if (busyKey) return;
    setBusyKey(key);
    setNotice(null);
    const failure = await persist(next);
    setBusyKey(null);
    if (failure) setNotice({ tone: failure === t('winStale') ? 'warning' : 'error', text: failure });
    else if (successText) toastSuccess(successText);
  }

  function openDialog(next: DialogState) {
    setNotice(null);
    setDialog(next);
    if (next) refreshZones();
  }

  async function submitDialog(draft: SlotDraft): Promise<string | null> {
    if (!dialog) return null;
    // وجهةٌ اختيرت حديثاً تُتحقَّق من حالتها الآن (قد يعطّلها مدير آخر بعد فتح الحوار): لا تُحفظ نافذة نشطة على وجهة لا تتطابق معها أي وجهة.
    const assigned = dialog.kind === 'edit' ? (slots[dialog.index]?.shippingZoneId ?? null) : null;
    if (draft.shippingZoneId !== '' && draft.shippingZoneId !== assigned) {
      const latest = await loadShippingZones();
      // تعذّر إثبات أن الوجهة ما زالت فعّالة ⇒ لا حفظ (الخادم يتحقق من وجودها لا من فعاليتها).
      if (!latest.ok) return failureText(latest, t);
      setZones({ kind: 'ready', zones: latest.data });
      const zone = latest.data.find((z) => z.id === draft.shippingZoneId);
      if (!zone || !zone.isActive) return t('winZoneUnavailable');
    }
    const next =
      dialog.kind === 'add'
        ? [...slots, draftToSlot(draft, null)]
        : slots.map((slot, index) => (index === dialog.index ? draftToSlot(draft, slot.id) : slot));
    const failure = await persist(next);
    if (failure === t('winStale')) {
      // المسوّدة بُنيت على قائمة قديمة: نُغلق الحوار ونعرض التحذير، فلا تُعاد كتابتها فوق ما غيّره المستخدم الآخر.
      setDialog(null);
      setNotice({ tone: 'warning', text: failure });

      return null;
    }
    if (failure) return failure;
    toastSuccess(dialog.kind === 'add' ? t('winAdded') : t('winUpdated'));
    setDialog(null);

    return null;
  }

  async function confirmDelete(): Promise<string | null> {
    if (deleteIndex === null) return null;
    const failure = await persist(slots.filter((_, index) => index !== deleteIndex));
    if (failure === t('winStale')) {
      setDeleteIndex(null);
      setNotice({ tone: 'warning', text: failure });

      return null;
    }
    if (failure) return failure;
    toastSuccess(t('winDeleted'));
    setDeleteIndex(null);

    return null;
  }

  const zoneName = (zoneId: string): string => {
    const zone = zones?.kind === 'ready' ? zones.zones.find((z) => z.id === zoneId) : undefined;
    if (!zone) return t('winZoneKept');

    return zone.isActive ? zone.name : `${zone.name} — ${t('winZoneInactive')}`;
  };
  const methodLabel = (method: DeliveryMethod) => (method === 'delivery' ? t('winMethodDelivery') : t('winMethodPickup'));
  const editing = dialog?.kind === 'edit' ? slots[dialog.index] : null;
  const toDelete = deleteIndex !== null ? slots[deleteIndex] : null;
  const atLimit = !canAddSlot(slots);

  return (
    <section aria-label={t('winTab')} className="space-y-4" data-windows-panel>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl space-y-1">
          <h2 className="text-sm font-semibold text-text">{t('winTab')}</h2>
          <p className="text-xs leading-5 text-muted">{t('winIntro')}</p>
        </div>
        <Button type="button" onClick={() => openDialog({ kind: 'add', method: 'delivery' })} disabled={atLimit || busyKey !== null} className="w-full sm:w-auto">
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('winAdd')}
        </Button>
      </div>
      {atLimit ? <p className="text-xs text-muted">{t('winLimit', { max: MAX_SLOTS })}</p> : null}
      {notice ? <FormAlert tone={notice.tone}>{notice.text}</FormAlert> : null}

      {slots.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={t('winEmptyTitle')}
          description={t('winEmptyDescription')}
          action={
            <Button type="button" onClick={() => openDialog({ kind: 'add', method: 'delivery' })}>
              {t('winAdd')}
            </Button>
          }
        />
      ) : (
        DELIVERY_METHODS.map((method) => {
          const rows = slots.map((slot, index) => ({ slot, index })).filter((row) => row.slot.method === method);
          if (rows.length === 0) return null;

          return (
            <div key={method} className="space-y-2" data-window-group={method}>
              <h3 className="text-xs font-semibold text-muted">{methodLabel(method)}</h3>
              <div className="overflow-hidden rounded border border-border bg-surface">
                <div className={cn('hidden border-b border-border bg-background px-4 py-2 text-xs font-medium text-muted', GRID)} aria-hidden="true">
                  <span>{t('winColName')}</span>
                  <span>{t('winColTime')}</span>
                  <span>{t('winColDays')}</span>
                  <span>{t('winColCapacity')}</span>
                  <span>{t('winColStatus')}</span>
                  <span className="w-[8.5rem]" />
                </div>
                <ul className="divide-y divide-border">
                  {rows.map(({ slot, index }, position) => {
                    const busy = busyKey !== null;
                    return (
                      <li key={slot.id ?? index} className={cn('space-y-2 px-4 py-3 text-sm md:space-y-0', GRID, !slot.isActive && 'text-muted')} data-window-row={slot.id ?? ''}>
                        <div className="min-w-0">
                          <p className={cn('truncate font-medium', slot.isActive ? 'text-text' : 'text-muted')}>{slot.label}</p>
                          {slot.labelEn ? <p className="truncate text-xs text-muted"><bdi>{slot.labelEn}</bdi></p> : null}
                          {slot.shippingZoneId ? (
                            <p className="truncate text-xs text-muted" data-window-zone>
                              {t('winZoneRow', { name: zoneName(slot.shippingZoneId) })}
                            </p>
                          ) : null}
                        </div>
                        <p>
                          <bdi className="num">{slot.startTime} – {slot.endTime}</bdi>
                        </p>
                        <p className="text-xs md:text-sm">{summarizeWeekdays(slot.weekdays, locale, t('winAllDays'))}</p>
                        <p className="text-xs md:text-sm">
                          <span className="text-muted md:hidden">{t('winColCapacity')}: </span>
                          {slot.capacity === null ? t('winCapUnlimited') : t('winCapOrders', { n: slot.capacity })}
                        </p>
                        <div className="flex items-center gap-2">
                          <Switch
                            aria-label={`${slot.label}: ${t('winActive')}`}
                            checked={slot.isActive}
                            disabled={busy}
                            onCheckedChange={(isActive) =>
                              void runInline(
                                `toggle-${index}`,
                                slots.map((s, i) => (i === index ? { ...s, isActive } : s)),
                                isActive ? t('winEnabled') : t('winDisabled'),
                              )
                            }
                          />
                          <span className="text-xs">{slot.isActive ? t('winStatusActive') : t('winStatusOff')}</span>
                        </div>
                        <div className="flex items-center gap-1 md:justify-end">
                          <Button type="button" variant="ghost" size="icon" aria-label={`${t('winEdit')}: ${slot.label}`} disabled={busy} onClick={() => openDialog({ kind: 'edit', index })}>
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`${t('winMoveUp')}: ${slot.label}`}
                            disabled={busy || position === 0}
                            onClick={() => void runInline(`up-${index}`, moveWithinMethod(slots, index, -1))}
                          >
                            <ArrowUp className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`${t('winMoveDown')}: ${slot.label}`}
                            disabled={busy || position === rows.length - 1}
                            onClick={() => void runInline(`down-${index}`, moveWithinMethod(slots, index, 1))}
                          >
                            <ArrowDown className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button type="button" variant="ghost" size="icon" aria-label={`${t('winDelete')}: ${slot.label}`} disabled={busy} onClick={() => setDeleteIndex(index)}>
                            <Trash2 className="h-4 w-4 text-negative" aria-hidden="true" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          );
        })
      )}

      {dialog ? (
        <SlotDialog
          key={dialog.kind === 'edit' ? `edit-${editing?.id ?? dialog.index}` : 'add'}
          title={dialog.kind === 'add' ? t('winAdd') : t('winEditTitle')}
          initial={dialog.kind === 'add' ? emptySlotDraft(dialog.method) : slotToDraft(editing as DeliverySlot)}
          zones={zones ?? { kind: 'loading' }}
          locale={locale}
          t={t}
          onClose={() => setDialog(null)}
          onSubmit={submitDialog}
        />
      ) : null}

      {toDelete ? (
        <ConfirmDialog
          title={t('winDeleteTitle')}
          message={t('winDeleteMessage', { label: toDelete.label })}
          confirmLabel={t('winDelete')}
          cancelLabel={t('cancel')}
          busyLabel={t('saving')}
          onClose={() => setDeleteIndex(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </section>
  );
}
