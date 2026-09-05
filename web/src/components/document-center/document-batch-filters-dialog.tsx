'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import type { DocumentBatchFilters } from '@/modules/document-center/contract';

type TeamUser = { id: string; name: string };

type Props = {
  open: boolean;
  onClose: () => void;
  filters: DocumentBatchFilters;
  reviewers: TeamUser[];
  onApply: (filters: DocumentBatchFilters) => void;
};

const STATUS_OPTIONS = [
  '',
  'needs_review',
  'reviewed',
  'ready_for_draft',
  'draft_created',
  'processing',
  'failed',
  'quarantined',
];

const CHANNEL_OPTIONS = ['', 'manual', 'web', 'email', 'api'];

export function DocumentBatchFiltersDialog({ open, onClose, filters, reviewers, onApply }: Props) {
  const t = useTranslations('documentCenterReview');
  const [draft, setDraft] = useState(filters);

  useEffect(() => {
    if (open) setDraft(filters);
  }, [open, filters]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onApply(draft);
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('advancedFilters')}>
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-2">
          <Label htmlFor="filter-status">{t('status')}</Label>
          <Select id="filter-status" value={draft.status} onChange={(e) => setDraft((c) => ({ ...c, status: e.target.value }))}>
            <option value="">{t('allStatuses')}</option>
            {STATUS_OPTIONS.filter(Boolean).map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="filter-reviewer">{t('reviewer')}</Label>
          <Select id="filter-reviewer" value={draft.reviewerId} onChange={(e) => setDraft((c) => ({ ...c, reviewerId: e.target.value }))}>
            <option value="">{t('allReviewers')}</option>
            {reviewers.map((user) => (
              <option key={user.id} value={user.id}>{user.name}</option>
            ))}
          </Select>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="filter-from">{t('dateFrom')}</Label>
            <input id="filter-from" type="date" value={draft.from} onChange={(e) => setDraft((c) => ({ ...c, from: e.target.value }))} className="h-10 rounded border border-border bg-surface px-3 text-sm" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="filter-to">{t('dateTo')}</Label>
            <input id="filter-to" type="date" value={draft.to} onChange={(e) => setDraft((c) => ({ ...c, to: e.target.value }))} className="h-10 rounded border border-border bg-surface px-3 text-sm" />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="filter-channel">{t('channel')}</Label>
          <Select id="filter-channel" value={draft.channel} onChange={(e) => setDraft((c) => ({ ...c, channel: e.target.value }))}>
            <option value="">{t('allChannels')}</option>
            {CHANNEL_OPTIONS.filter(Boolean).map((channel) => (
              <option key={channel} value={channel}>{channel}</option>
            ))}
          </Select>
        </div>
        <label className="flex min-h-9 items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={draft.blockingOnly}
            onChange={(e) => setDraft((c) => ({ ...c, blockingOnly: e.target.checked }))}
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
          />
          {t('blockingOnly')}
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit">{t('applyFilters')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
