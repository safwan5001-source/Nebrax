'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight, Check, RotateCcw, X } from 'lucide-react';
import type { FuelHelpProcedure, HelpLocale } from '@/modules/help-center/fuel';

/**
 * دليل تفاعلي خطوة بخطوة: خطوة واحدة على الشاشة بخط كبير وأزرار لمس 48px، لموظف يعمل واقفاً على الجوال.
 * لا يخزّن شيئاً ولا يكتب في النظام ولا ينفّذ العملية نيابةً عن المستخدم: يرشده فقط.
 */
export function FuelHelpGuidePlayer({
  procedure,
  locale,
  onExit,
}: {
  procedure: FuelHelpProcedure;
  locale: HelpLocale;
  onExit: () => void;
}) {
  const t = useTranslations('fuelHelp');
  const [index, setIndex] = useState(0);
  const total = procedure.steps.length;
  const finished = index >= total;
  const percent = Math.round((Math.min(index, total) / total) * 100);

  return (
    <section aria-label={t('guide.title')} className="rounded-[16px] border border-primary/40 bg-surface p-4 shadow-sm sm:p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-primary">{t('guide.title')}</p>
          <h2 className="mt-0.5 text-base font-semibold leading-6 text-text">{procedure.title[locale]}</h2>
        </div>
        <button
          type="button"
          onClick={onExit}
          aria-label={t('guide.exit')}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] text-muted hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <X aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />
        </button>
      </header>

      <div
        role="progressbar"
        aria-label={t('guide.progress')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="mt-3 h-2 overflow-hidden rounded-full bg-primary-soft"
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${percent}%` }} />
      </div>

      {finished ? (
        <div className="py-6 text-center" role="status">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary-soft text-primary"><Check aria-hidden="true" className="h-6 w-6" strokeWidth={2} /></span>
          <p className="mt-3 text-base font-semibold text-text">{t('guide.done')}</p>
          <p className="mt-1 text-sm text-muted">{t('guide.doneHint')}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => setIndex(0)} className="inline-flex min-h-12 items-center gap-2 rounded-[12px] border border-border px-4 text-sm font-semibold text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              <RotateCcw aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />{t('guide.restart')}
            </button>
            <button type="button" onClick={onExit} className="min-h-12 rounded-[12px] bg-primary px-5 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              {t('guide.exit')}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-5" aria-live="polite">
          <p className="text-xs font-medium text-muted">{t('guide.stepOf', { current: index + 1, total })}</p>
          <p className="mt-2 text-lg leading-8 text-text">{procedure.steps[index][locale]}</p>
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => setIndex((value) => Math.max(0, value - 1))}
              disabled={index === 0}
              className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-[12px] border border-border text-sm font-semibold text-text hover:bg-primary-soft disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <ArrowRight aria-hidden="true" className="h-4 w-4 ltr:rotate-180" strokeWidth={1.8} />{t('guide.previous')}
            </button>
            <button
              type="button"
              onClick={() => setIndex((value) => value + 1)}
              className="inline-flex min-h-12 flex-[1.4] items-center justify-center gap-2 rounded-[12px] bg-primary text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {index === total - 1 ? t('guide.finish') : t('guide.next')}
              {index === total - 1 ? <Check aria-hidden="true" className="h-4 w-4" strokeWidth={2} /> : <ArrowLeft aria-hidden="true" className="h-4 w-4 ltr:rotate-180" strokeWidth={1.8} />}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
