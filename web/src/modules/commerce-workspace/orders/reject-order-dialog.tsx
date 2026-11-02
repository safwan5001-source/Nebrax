'use client';

import { useId, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { FormAlert } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { classifyAcceptError, failureMeansStale, rejectOrder, validateRejectNote, type AcceptFailure } from './accept-order';
import { REJECTION_NOTE_MAX, type OrderDetail } from './contract';
import { ordersMessages } from './messages';

/**
 * COPS-H1-5 — حوار تأكيد رفض الطلب (إلغاء بسبب «رفض التاجر»). لا يقرّر الأهلية: يجمع ملاحظة اختيارية ويُرسل، والخادم يحكم (409 ⇒ يُعرض سببه ويُحدَّث الأب).
 * لا إرسال مكرر: قفل متزامن بـ`useRef` (نقرتان في الإطار نفسه) + تعطيل الأزرار أثناء الطلب، ولا يُغلق أثناء الطلب. بعد 409/404/شبكة (حالة قديمة أو غير
 * مؤكَّدة) يُقفل التأكيد ويُستدعى `onStale` فيحدّث الأب من الخادم — لا إعادة محاولة على حالة قديمة.
 */
export function RejectOrderDialog({
  open,
  orderNumber,
  orderId,
  onClose,
  onRejected,
  onStale,
}: {
  open: boolean;
  orderNumber: string;
  orderId: string;
  onClose: () => void;
  onRejected: (order: OrderDetail) => void;
  onStale: () => void;
}) {
  const locale = useLocale();
  const { t, label } = ordersMessages(locale);
  const ids = { note: useId(), noteErr: useId(), counter: useId() };
  const [note, setNote] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<AcceptFailure | null>(null);
  const [locked, setLocked] = useState(false);
  const inFlight = useRef(false);

  const noteError = attempted && validateRejectNote(note) !== null ? t('rejectNoteTooLong') : null;

  const close = () => {
    if (inFlight.current) return;
    onClose();
  };

  const submit = async () => {
    if (inFlight.current || locked) return;
    setAttempted(true);
    if (validateRejectNote(note) !== null) return;
    inFlight.current = true;
    setPending(true);
    setFailure(null);
    try {
      onRejected(await rejectOrder(orderId, note));
    } catch (error) {
      const failed = classifyAcceptError(error);
      setFailure(failed);
      if (failureMeansStale(failed)) {
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
    const base = label('acceptError', failure.kind);
    const blocked = failure.reason ? label('blocked', failure.reason) : null;

    return blocked && blocked !== failure.reason ? `${base} ${blocked}` : base;
  })();

  return (
    <Dialog open={open} onClose={close} title={`${t('rejectDialogTitle')} ${orderNumber}`} hideClose={pending}>
      <form
        className="space-y-4"
        aria-busy={pending}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        noValidate
      >
        <p className="text-sm leading-relaxed text-muted">{t('rejectDialogIntro')}</p>

        <div className="space-y-1.5">
          <Label htmlFor={ids.note}>
            {t('rejectNoteLabel')} <span className="text-xs font-normal text-muted">({t('rejectNoteHint')})</span>
          </Label>
          <Textarea
            id={ids.note}
            value={note}
            maxLength={REJECTION_NOTE_MAX}
            rows={3}
            disabled={pending || locked}
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
            <span id={ids.counter} className={cn('num text-xs', note.length >= REJECTION_NOTE_MAX ? 'text-warning' : 'text-muted')} dir="ltr">
              {note.length}/{REJECTION_NOTE_MAX}
            </span>
          </div>
        </div>

        {failureText ? <FormAlert tone="error">{failureText}</FormAlert> : null}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={close} disabled={pending}>
            {locked ? t('rejectClose') : t('rejectKeep')}
          </Button>
          <Button type="submit" variant="danger" disabled={pending || locked} aria-disabled={pending || locked}>
            {pending ? t('rejectSubmitting') : t('rejectConfirm')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
