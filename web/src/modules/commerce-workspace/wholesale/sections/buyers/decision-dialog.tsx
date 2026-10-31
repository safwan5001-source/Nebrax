'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { classifyError, errorReason } from '../../use-resource';
import { commonMessages } from '../../messages/common';
import { DECISION_NOTE_MAX, transitionMembership, type Membership, type MembershipAction } from './api';
import { buyersMessages, type BuyersMessageKey } from './messages';

/** Friendly text for a rejected decision: server `reason` first, then the HTTP class. */
export function decisionErrorKey(error: unknown): BuyersMessageKey {
  const reason = errorReason(error);
  if (reason === 'invalid_transition' || reason === 'not_found' || reason === 'unknown_action') return `error.${reason}`;
  const kind = classifyError(error);
  if (kind === 'forbidden') return 'error.forbidden';
  if (kind === 'validation') return 'error.validation';
  if (kind === 'network') return 'error.network';
  return 'error.unknown';
}

/**
 * Confirmation for one membership decision. State-changing, so it always asks and always reports: a success toast
 * and `onDone(updated)`, or an inline error (kept open so the note is not lost) plus an error toast. A stale-status
 * conflict (`invalid_transition`) also asks the parent to refresh via `onConflict`.
 */
export function DecisionDialog({
  membership,
  action,
  onClose,
  onDone,
  onConflict,
}: {
  membership: Membership | null;
  action: MembershipAction | null;
  onClose: () => void;
  onDone: (updated: Membership, action: MembershipAction) => void;
  onConflict: () => void;
}) {
  const locale = useLocale();
  const { t } = buyersMessages.forLocale(locale);
  const common = commonMessages.forLocale(locale).t;
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<BuyersMessageKey | null>(null);
  const open = membership !== null && action !== null;

  const close = () => {
    if (busy) return;
    setNote('');
    setErrorKey(null);
    onClose();
  };

  async function submit() {
    if (!membership || !action) return;
    setBusy(true);
    setErrorKey(null);
    try {
      const updated = await transitionMembership(membership.id, action, note);
      toast.success(t(`done.${action}` as BuyersMessageKey));
      setNote('');
      onDone(updated, action);
    } catch (error) {
      const key = decisionErrorKey(error);
      setErrorKey(key);
      toast.error(t(key));
      if (key === 'error.invalid_transition' || key === 'error.not_found') onConflict();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={close} title={action ? t(`actionTitle.${action}` as BuyersMessageKey) : ''} closeLabel={common('close')} hideClose={busy}>
      {action && membership ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <p className="text-sm font-medium text-text"><bdi>{membership.customer.display_name ?? t('unnamedBuyer')}</bdi></p>
          <p className="text-sm leading-relaxed text-muted">{t(`actionBody.${action}` as BuyersMessageKey)}</p>
          <div>
            <Label htmlFor="wholesale-decision-note">{t('noteLabel')}</Label>
            <Textarea
              id="wholesale-decision-note"
              value={note}
              maxLength={DECISION_NOTE_MAX}
              disabled={busy}
              aria-describedby="wholesale-decision-note-hint"
              onChange={(event) => setNote(event.target.value)}
            />
            <div id="wholesale-decision-note-hint" className="mt-1 flex justify-between gap-2 text-xs text-muted">
              <span>{t('noteHint', { max: DECISION_NOTE_MAX })}</span>
              <span className="num" dir="ltr">{t('noteCounter', { count: note.length, max: DECISION_NOTE_MAX })}</span>
            </div>
          </div>
          {errorKey ? <p role="alert" className="rounded border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">{t(errorKey)}</p> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={close}>{common('cancel')}</Button>
            <Button type="submit" variant={action === 'reject' || action === 'suspend' ? 'danger' : 'primary'} className="min-h-11" disabled={busy}>
              {busy ? t('submitting') : t(`action.${action}` as BuyersMessageKey)}
            </Button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}
