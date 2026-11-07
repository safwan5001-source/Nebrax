'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, CirclePlay, RotateCcw, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSmartGuide, type TourView } from './guide-context';

/**
 * «الجولات التفاعلية» داخل مركز المساعدة (تطبيق المحطات فقط): تعرض الجولات التي تحق للمستخدم بحالة كل منها، وتتيح البدء/الاستئناف/الإعادة.
 * جولة شاشتها تحتاج معرّفاً (التسليم) لا تُشغَّل من هنا؛ يُعرض رابط شاشة الدخول إليها وتبدأ من زر «؟» هناك.
 */
export function GuideToursPanel() {
  const t = useTranslations('stationOps');
  const guide = useSmartGuide();
  const [notice, setNotice] = useState<string | null>(null);
  if (!guide) return null;
  const { tours } = guide;

  async function run(view: TourView, resume: boolean) {
    setNotice(null);
    const started = await guide!.start(view.tour.id, { resume });
    if (!started) setNotice(t('guide.panel.notReady'));
  }

  return (
    <section aria-labelledby="fo-tours-h" data-guide-panel="" className="rounded-[16px] border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft text-primary"><Sparkles className="h-5 w-5" strokeWidth={1.8} /></span>
        <div className="min-w-0">
          <h2 id="fo-tours-h" className="text-base font-semibold text-text">{t('guide.panel.title')}</h2>
          <p className="mt-0.5 text-[13px] leading-6 text-muted">{t('guide.panel.hint')}</p>
        </div>
      </div>

      {tours.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t('guide.panel.none')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-[12px] border border-border bg-background">
          {tours.map((view) => {
            const { tour, status } = view;
            const resumable = status === 'in_progress';
            return (
              <li key={tour.id} data-tour={tour.id} data-tour-status={status} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text">{t(`guide.tour.${tour.id}.name`)}</p>
                  <p className="mt-0.5 text-[13px] leading-5 text-muted">{t(`guide.tour.${tour.id}.summary`)}</p>
                  <p className={cn('mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium', status === 'completed' ? 'text-positive' : 'text-muted')}>
                    {status === 'completed' ? <Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} /> : null}
                    {t(`guide.panel.status.${status}`)}
                  </p>
                  {tour.dynamic ? <p className="mt-1 text-[12px] leading-5 text-muted">{t(`guide.tour.${tour.id}.where`)}</p> : null}
                </div>
                {tour.dynamic ? (
                  <Link
                    href={tour.entry}
                    className="inline-flex min-h-11 items-center rounded-[11px] border border-[color:var(--fo-control)] px-4 text-sm font-semibold text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {t('guide.panel.openScreen')}
                  </Link>
                ) : (
                  <div className="flex gap-2">
                    {resumable ? (
                      <button type="button" onClick={() => void run(view, true)} className="inline-flex min-h-11 items-center gap-1.5 rounded-[11px] bg-[color:var(--fo-cta-bg)] px-4 text-sm font-bold text-[color:var(--fo-cta-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                        <CirclePlay aria-hidden="true" className="h-4 w-4" strokeWidth={1.9} />{t('guide.panel.resume')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void run(view, false)}
                      className={cn('inline-flex min-h-11 items-center gap-1.5 rounded-[11px] px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', resumable ? 'border border-[color:var(--fo-control)] text-text hover:bg-primary-soft' : 'bg-[color:var(--fo-cta-bg)] font-bold text-[color:var(--fo-cta-fg)]')}
                    >
                      {status === 'completed' || status === 'skipped' || resumable ? <RotateCcw aria-hidden="true" className="h-4 w-4" strokeWidth={1.9} /> : <CirclePlay aria-hidden="true" className="h-4 w-4" strokeWidth={1.9} />}
                      {status === 'new' ? t('guide.panel.start') : t('guide.panel.replay')}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {notice ? <p role="status" className="mt-2 text-sm text-warning">{notice}</p> : null}
      <p className="mt-3 text-[12px] leading-5 text-muted">{t('guide.panel.persistNote')}</p>
    </section>
  );
}

/** زر «ابدأ جولة هذه الشاشة» داخل ورقة المساعدة السياقية: يظهر فقط حين توجد جولة لشاشتها تحق للمستخدم. */
export function GuideScreenShortcut({ close }: { close: () => void }) {
  const t = useTranslations('stationOps');
  const guide = useSmartGuide();
  const tour = guide?.forPathname(usePathname() ?? '');
  if (!guide || !tour) return null;
  return (
    <button
      type="button"
      data-guide-shortcut=""
      onClick={() => {
        close();
        // بعد إغلاق الورقة (استعادة التركيز) لا قبلها، كي لا تتنازع الجولة والورقة على التركيز.
        window.setTimeout(() => void guide.start(tour.id), 350);
      }}
      className="mb-2 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[12px] border border-primary text-sm font-semibold text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <Sparkles aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />{t('guide.panel.startHere')}
    </button>
  );
}
