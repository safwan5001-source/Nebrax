'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import type { DraftBackup, DraftConflictInfo } from './draft-save';

/**
 * AD-01 / S01b — حوارات سلامة الحفظ: التعارض (409)، مغادرة الصفحة بتعديلات غير محفوظة، واستعادة نسخة محلية.
 * قاعدة الكتابة فوق: لا تُرسَل أبداً قبل إعادة جلب أحدث revision وتأكيد صريح — هذا المكوّن يعرض الخطوات فقط والصفحة تنفّذها.
 */

export type ConflictStage = 'choose' | 'confirmReload' | 'confirmOverwrite';

export interface ConflictState {
  info: DraftConflictInfo;
  stage: ConflictStage;
  /** أحدث مسودة محفوظة كما أُعيد جلبها قبل الكتابة فوق. */
  latest: { revision: number; updatedAt: string | null } | null;
  busy: boolean;
  /** تغيّرت المسودة ثانيةً أثناء محاولة الكتابة فوق. */
  changedAgain: boolean;
}

function whenLabel(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString(locale);
}

export function DraftConflictDialog({
  state, locale, onKeepEditing, onCopy, onAskReload, onConfirmReload, onAskOverwrite, onConfirmOverwrite, onBack,
}: {
  state: ConflictState | null;
  locale: string;
  onKeepEditing: () => void;
  onCopy: () => void;
  onAskReload: () => void;
  onConfirmReload: () => void;
  onAskOverwrite: () => void;
  onConfirmOverwrite: () => void;
  onBack: () => void;
}) {
  const t = useTranslations('appBuilder.builder');
  if (!state) return null;
  const { info, stage, latest, busy, changedAgain } = state;
  const infoWhen = whenLabel(info.updatedAt, locale);
  const latestWhen = latest ? whenLabel(latest.updatedAt, locale) : null;

  return (
    <Dialog open onClose={() => (busy ? null : onKeepEditing())} title={t('conflict.title')} hideClose={busy}>
      {stage === 'choose' ? (
        <div className="space-y-3 text-sm leading-6 text-text">
          {changedAgain ? <p role="alert" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2">{t('conflict.changedAgain')}</p> : null}
          <p>{t('conflict.body', { current: info.currentRevision, base: info.baseRevision })}</p>
          {infoWhen ? <p className="text-xs text-muted">{t('conflict.lastSaved', { when: infoWhen })}</p> : null}
          <p className="text-xs text-muted">{t('conflict.safeNote')}</p>
          <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <Button type="button" variant="ghost" disabled={busy} onClick={onKeepEditing}>{t('conflict.keepEditing')}</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={onCopy}>{t('conflict.copyMine')}</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={onAskReload}>{t('conflict.reload')}</Button>
            <Button type="button" disabled={busy} onClick={onAskOverwrite}>{busy ? t('conflict.checkingLatest') : t('conflict.overwrite')}</Button>
          </div>
        </div>
      ) : null}

      {stage === 'confirmReload' ? (
        <div className="space-y-3 text-sm leading-6 text-text">
          <p>{t('conflict.confirmReloadBody', { current: info.currentRevision })}</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" disabled={busy} onClick={onBack}>{t('conflict.back')}</Button>
            <Button type="button" disabled={busy} onClick={onConfirmReload}>{t('conflict.confirmReloadAction')}</Button>
          </div>
        </div>
      ) : null}

      {stage === 'confirmOverwrite' && latest ? (
        <div className="space-y-3 text-sm leading-6 text-text">
          <p>{t('conflict.confirmOverwriteBody', { latest: latest.revision })}</p>
          {latestWhen ? <p className="text-xs text-muted">{t('conflict.lastSaved', { when: latestWhen })}</p> : null}
          <p className="text-xs text-muted">{t('conflict.overwriteWarning')}</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" disabled={busy} onClick={onBack}>{t('conflict.back')}</Button>
            <Button type="button" disabled={busy} onClick={onConfirmOverwrite}>{busy ? t('savingBadge') : t('conflict.confirmOverwriteAction')}</Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

export function LeaveGuardDialog({ open, onStay, onLeave }: { open: boolean; onStay: () => void; onLeave: () => void }) {
  const t = useTranslations('appBuilder.builder');
  return (
    <Dialog open={open} onClose={onStay} title={t('leave.title')}>
      <p className="text-sm leading-6 text-text">{t('leave.body')}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onLeave}>{t('leave.leaveAction')}</Button>
        <Button type="button" onClick={onStay}>{t('leave.stayAction')}</Button>
      </div>
    </Dialog>
  );
}

export function RecoverBackupDialog({
  backup, locale, onRestore, onDiscard,
}: { backup: DraftBackup | null; locale: string; onRestore: () => void; onDiscard: () => void }) {
  const t = useTranslations('appBuilder.builder');
  if (!backup) return null;
  const when = whenLabel(backup.savedAt, locale);
  return (
    <Dialog open onClose={() => {}} title={t('recovery.title')} hideClose>
      <p className="text-sm leading-6 text-text">{t('recovery.body')}</p>
      {when ? <p className="mt-2 text-xs text-muted">{t('recovery.savedAt', { when })}</p> : null}
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDiscard}>{t('recovery.discard')}</Button>
        <Button type="button" onClick={onRestore}>{t('recovery.restore')}</Button>
      </div>
    </Dialog>
  );
}
