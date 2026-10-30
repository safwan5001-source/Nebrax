'use client';

import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { formatDateTime } from '@/lib/formatting';
import { commonMessages } from '../../messages/common';
import { StatusBadge, MEMBERSHIP_STATUS_TONE, toneFor } from '../../components/status-badge';
import { actionsFor, type Membership, type MembershipAction } from './api';
import { buyersMessages, type BuyersMessageKey } from './messages';

/** Detail drawer for one membership; decision buttons are exactly the transitions valid for its current status. */
export function MembershipSheet({
  membership,
  canDecide,
  onClose,
  onAction,
}: {
  membership: Membership | null;
  canDecide: boolean;
  onClose: () => void;
  onAction: (membership: Membership, action: MembershipAction) => void;
}) {
  const locale = useLocale();
  const { t } = buyersMessages.forLocale(locale);
  const common = commonMessages.forLocale(locale).t;
  const actions = membership && canDecide ? actionsFor(membership.status) : [];

  return (
    <Sheet open={membership !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent closeLabel={common('close')} aria-describedby="wholesale-membership-hint">
        {membership ? (
          <>
            <div className="border-b border-border p-4 pe-14">
              <SheetTitle className="text-base font-semibold text-text"><bdi>{membership.customer.display_name ?? t('unnamedBuyer')}</bdi></SheetTitle>
              <SheetDescription id="wholesale-membership-hint" className="mt-1 text-xs text-muted">{t('detailHint')}</SheetDescription>
              <div className="mt-2">
                <StatusBadge tone={toneFor(MEMBERSHIP_STATUS_TONE, membership.status)}>{buyersMessages.forLocale(locale).label('status', membership.status)}</StatusBadge>
              </div>
            </div>
            <dl className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
              <Row label={t('email')}><span className="break-all" dir="ltr">{membership.customer.email ?? '—'}</span></Row>
              <Row label={t('phone')}><span className="num" dir="ltr">{membership.customer.phone ?? '—'}</span></Row>
              <Row label={t('appliedAt')}><span className="num">{formatDateTime(membership.applied_at, locale)}</span></Row>
              {membership.decided_at ? (
                <>
                  <Row label={t('decidedAt')}><span className="num">{formatDateTime(membership.decided_at, locale)}</span></Row>
                  <Row label={t('decidedBy')}><bdi>{membership.decided_by?.name ?? '—'}</bdi></Row>
                  <Row label={t('decisionNote')}>{membership.decision_note ? <bdi className="whitespace-pre-wrap">{membership.decision_note}</bdi> : <span className="text-muted">{t('noNote')}</span>}</Row>
                </>
              ) : (
                <Row label={t('decidedAt')}><span className="text-muted">{t('noDecisionYet')}</span></Row>
              )}
            </dl>
            {actions.length > 0 ? (
              <div className="flex flex-col gap-2 border-t border-border p-4 sm:flex-row sm:justify-end">
                {actions.map((action) => (
                  <Button
                    key={action}
                    type="button"
                    className="min-h-11"
                    variant={action === 'approve' || action === 'reinstate' ? 'primary' : 'outline'}
                    onClick={() => onAction(membership, action)}
                  >
                    {t(`action.${action}` as BuyersMessageKey)}
                  </Button>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="text-text">{children}</dd>
    </div>
  );
}
