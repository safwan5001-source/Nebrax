'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Printer, Barcode, Wifi, Building2, Power } from 'lucide-react';

/** نقطة حالة ملوّنة (متصل/غير متصل) على زر أداة. */
function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className="absolute end-1 top-1 h-[7px] w-[7px] rounded-full border-2 border-surface"
      style={{ background: ok ? 'var(--positive)' : 'var(--negative)' }}
    />
  );
}

/** الشريط العلوي الخاص بنقطة البيع: حالة الأجهزة + ساعة حيّة + الفرع + الكاشير. */
export function PosTopbar({
  cashier,
  branch,
  onEndSession,
}: {
  cashier: string;
  branch: string;
  onEndSession?: () => void;
}) {
  const t = useTranslations('pos');
  const [now, setNow] = useState<Date | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    const sync = () => setOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      clearInterval(id);
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  const time = now?.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) ?? '—';
  const date = now?.toLocaleDateString('ar-SA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) ?? '';

  const tool = 'relative grid h-[34px] w-[34px] place-items-center rounded-lg border border-border bg-surface text-text hover:bg-background';

  return (
    <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border bg-surface px-4">
      <button className={tool} title={t('end_session')} onClick={onEndSession}>
        <Power className="h-4 w-4" strokeWidth={1.8} />
      </button>
      <button className={tool} title={t('printer')}>
        <Printer className="h-4 w-4" strokeWidth={1.8} />
        <StatusDot ok />
      </button>
      <button className={tool} title={t('barcode')}>
        <Barcode className="h-4 w-4" strokeWidth={1.8} />
        <StatusDot ok />
      </button>
      <button className={tool} title={t('internet')}>
        <Wifi className="h-4 w-4" strokeWidth={1.8} />
        <StatusDot ok={online} />
      </button>

      <div className="flex-1" />

      <div className="text-center leading-tight">
        <b className="num block text-[13px] font-bold text-text">{time}</b>
        <span className="text-[11px] text-muted">{date}</span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs">
        <Building2 className="h-3.5 w-3.5 text-muted" strokeWidth={1.7} />
        <span>{branch}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="text-end text-[11px] text-muted">
          {t('cashier')}
          <b className="block text-[12.5px] font-semibold text-text">{cashier}</b>
        </div>
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-xs font-bold text-white">
          {cashier.slice(0, 2)}
        </div>
      </div>
    </header>
  );
}
