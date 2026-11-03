'use client';

import { Expand, Minimize2, MonitorSmartphone } from 'lucide-react';
import { receptionMessages } from './messages';
import { useFullscreen, useWakeLock } from './use-screen';

/** أزرار الشاشة في ترويسة اللوحة. الحالة الفعلية نص صريح؛ لا ادّعاء دعم حيث لا يدعم المتصفح. */
export function ScreenControls({ locale }: { locale: string }) {
  const { t } = receptionMessages(locale);
  const wake = useWakeLock();
  const full = useFullscreen();
  const wakeOn = wake.state === 'active' || wake.state === 'released';
  const note =
    wake.state === 'unsupported' ? t('wakeLockUnsupported')
    : wake.state === 'denied' ? t('wakeLockDenied')
    : wake.state === 'released' ? t('wakeLockReleased')
    : wake.state === 'active' ? t('wakeLockActive')
    : full.state === 'unsupported' ? t('fullscreenUnsupported')
    : full.state === 'denied' ? t('fullscreenDenied')
    : null;
  const button = 'inline-flex min-h-11 items-center gap-2 rounded border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50';

  return (
    <>
      <button
        type="button"
        data-testid="board-wakelock"
        aria-pressed={wakeOn}
        disabled={wake.state === 'unsupported'}
        onClick={wake.toggle}
        className={`${button} ${wakeOn ? 'border-primary bg-primary-soft text-primary' : 'border-border text-text hover:bg-primary-soft'}`}
      >
        <MonitorSmartphone aria-hidden="true" className="h-4 w-4" />
        {wakeOn ? t('wakeLockOff') : t('wakeLockOn')}
      </button>
      <button
        type="button"
        data-testid="board-fullscreen"
        aria-pressed={full.state === 'on'}
        disabled={full.state === 'unsupported'}
        onClick={full.toggle}
        className={`${button} ${full.state === 'on' ? 'border-primary bg-primary-soft text-primary' : 'border-border text-text hover:bg-primary-soft'}`}
      >
        {full.state === 'on' ? <Minimize2 aria-hidden="true" className="h-4 w-4" /> : <Expand aria-hidden="true" className="h-4 w-4" />}
        {full.state === 'on' ? t('fullscreenExit') : t('fullscreenEnter')}
      </button>
      {note !== null && <p data-testid="board-screen-note" role="status" className="w-full text-xs text-muted">{note}</p>}
    </>
  );
}
