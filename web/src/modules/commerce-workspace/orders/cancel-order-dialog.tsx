'use client';

import { useId, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { FormAlert } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { classifyCancelError, cancelOrder, validateCancelInput, type CancelFailure } from './cancel-order';
import { CANCELLATION_NOTE_MAX, CANCELLATION_REASONS, type CancellationReason, type OrderDetail } from './contract';
import { ordersMessages, type OrdersMessageKey } from './messages';

/**
 * COMMERCE-ORDERS-O3b — حوار تأكيد إلغاء الطلب. لا يقرّر أهلية الإلغاء: يجمع السبب والملاحظة ويُرسل، والخادم يحكم (409 ⇒ يُعرض سببه
 * ويُطلب التحديث). لا إرسال مكرر: قفل متزامن بـ`useRef` (النقرتان في الإطار نفسه) + تعطيل الأزرار أثناء الطلب. لا يُغلق أثناء الطلب.
 *
 * `onCancelled` يستلم تفاصيل الطلب المحدَّثة من الخادم (لا نفترض النجاح). `onStale` يُستدعى حين يتغيّر الوضع (409/404/شبكة) ليحدّث
 * الأب بيانات الطلب من الخادم؛ ويبقى الحوار مفتوحاً بالرسالة وبتأكيد معطَّل حتى لا تُعاد المحاولة على حالة قديمة.
 */
export function CancelOrderDialog({
  open,
  orderNumber,
  orderId,
  onClose,
  onCancelled,
  onStale,
}: {
  open: boolean;
  orderNumber: string;
  orderId: string;
  onClose: () => void;
  onCancelled: (order: OrderDetail) => void;
  onStale: () => void;
}) {
  const locale = useLocale();
  const { t, label } = ordersMessages(locale);
  const ids = { reason: useId(), note: useId(), reasonErr: useId(), noteErr: useId(), counter: useId() };
  const [reason, setReason] = useState<CancellationReason | ''>('');
  const [note, setNote] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<CancelFailure | null>(null);
  const [locked, setLocked] = useState(false);
  const inFlight = useRef(false);

  const fieldError = validateCancelInput({ reason, note });
  const showError = attempted ? fieldError : null;
  const noteRequired = reason === 'other';

  const close = () => {
    if (inFlight.current) return;
    onClose();
  };

  const submit = async () => {
    if (inFlight.current || locked) return;
    setAttempted(true);
    if (fieldError !== null) return;
    inFlight.current = true;
    setPending(true);
    setFailure(null);
    try {
      const updated = await cancelOrder(orderId, { reason, note });
      onCancelled(updated);
    } catch (error) {
      const failed = classifyCancelError(error);
      setFailure(failed);
      if (failed.kind === 'validation') {
        // رفض مدخل: يبقى الحوار قابلاً للتصحيح.
      } else if (failed.kind === 'forbidden' || failed.kind === 'session' || failed.kind === 'unknown') {
        // لا تغيير مؤكَّد في الحالة؛ يعيد المحاولة يدوياً.
      } else {
        // 409/404/شبكة: الحالة تغيّرت أو غير مؤكَّدة ⇒ تحديث من الخادم ولا إعادة محاولة على بيانات قديمة.
        setLocked(true);
        onStale();
      }
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const failureText = (() => {
    if (failure === null) return null;
    const base = label('cancelError', failure.kind === 'conflict' ? 'conflict' : failure.kind);
    const blocked = failure.reason ? label('blocked', failure.reason) : null;

    return blocked && blocked !== failure.reason ? `${base} ${blocked}` : base;
  })();

  const errorKey: Record<NonNullable<ReturnType<typeof validateCancelInput>>, OrdersMessageKey> = {
    reason_required: 'cancelReasonRequired',
    note_required: 'cancelNoteRequired',
    note_too_long: 'cancelNoteTooLong',
  };
  const reasonError = showError === 'reason_required' ? t(errorKey[showError]) : null;
  const noteError = showError === 'note_required' || showError === 'note_too_long' ? t(errorKey[showError]) : null;

  return (
    <Dialog open={open} onClose={close} title={`${t('cancelDialogTitle')} ${orderNumber}`} hideClose={pending}>
      <form
        className="space-y-4"
        aria-busy={pending}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        noValidate
      >
        <p className="text-sm leading-relaxed text-muted">{t('cancelDialogIntro')}</p>

        <div className="space-y-1.5">
          <Label htmlFor={ids.reason}>{t('cancelReasonLabel')}</Label>
          <Select
            id={ids.reason}
            value={reason}
            disabled={pending || locked}
            aria-required="true"
            aria-invalid={reasonError !== null}
            aria-describedby={reasonError ? ids.reasonErr : undefined}
            onChange={(event) => setReason(event.target.value as CancellationReason | '')}
          >
            <option value="">{t('cancelReasonPlaceholder')}</option>
            {CANCELLATION_REASONS.map((value) => (
              <option key={value} value={value}>
                {label('reason', value)}
              </option>
            ))}
          </Select>
          {reasonError ? (
            <p id={ids.reasonErr} role="alert" className="text-xs text-negative">
              {reasonError}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={ids.note}>
            {t('cancelNoteLabel')}{' '}
            <span className="text-xs font-normal text-muted">({noteRequired ? t('cancelNoteRequiredHint') : t('cancelNoteOptionalHint')})</span>
          </Label>
          <Textarea
            id={ids.note}
            value={note}
            maxLength={CANCELLATION_NOTE_MAX}
            rows={3}
            disabled={pending || locked}
            aria-required={noteRequired}
            aria-invalid={noteError !== null}
            aria-describedby={[noteError ? ids.noteErr : null, ids.counter].filter(Boolean).join(' ')}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="flex items-start justify-between gap-2">
            {noteError ? (
              <p id={ids.noteErr} role="alert" className="text-xs text-negative">
                {noteError}
              </p>
            ) : (
              <span />
            )}
            <span id={ids.counter} className={cn('num text-xs', note.length >= CANCELLATION_NOTE_MAX ? 'text-warning' : 'text-muted')} dir="ltr">
              {note.length}/{CANCELLATION_NOTE_MAX}
            </span>
          </div>
        </div>

        {failureText ? <FormAlert tone="error">{failureText}</FormAlert> : null}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={close} disabled={pending}>
            {locked ? t('cancelClose') : t('cancelKeep')}
          </Button>
          <Button type="submit" variant="danger" disabled={pending || locked} aria-disabled={pending || locked}>
            {pending ? t('cancelSubmitting') : t('cancelConfirm')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
