'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { findTarget, waitForTarget } from './plan';
import type { TourId, TourStep } from './tours';

/**
 * AWJ Smart Guide — الطبقة المرئية: Spotlight فوق العنصر الحقيقي + تعتيم الخلفية + بطاقة شرح.
 *
 * مبادئ ثابتة:
 *  - **لا تحجب التشغيل:** الـSpotlight والتعتيم `pointer-events: none` فيبقى كل زر حقيقي قابلاً للضغط، والبطاقة وحدها تلتقط اللمس.
 *  - **لا تنفّذ شيئاً:** لا ضغط ولا إرسال ولا طلب شبكة من هنا (يحرسه اختبار معماري).
 *  - **غير مُقيِّدة للتركيز** (`aria-modal=false`): تُنقل الرؤية إلى البطاقة عند كل خطوة، ويمكن Tab إلى الزر الحقيقي، و Esc = تخطّي.
 *  - **تقليل الحركة:** `prefers-reduced-motion` يوقف الانتقالات والتمرير الناعم.
 *  - بطاقة سفلية/علوية على الجوال (بجانب الأقل ازدحاماً وفوق التنقل السفلي)، وعائمة قرب العنصر على الشاشات العريضة.
 */
const DIM = 'rgba(12, 22, 38, 0.66)';
const PAD = 8;
const GAP = 14;
const MARGIN = 12;

interface Box { top: number; left: number; width: number; height: number }

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

function hasFixedAncestor(element: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const position = window.getComputedStyle(node).position;
    if (position === 'fixed' || position === 'sticky') return true;
  }
  return false;
}

/** ارتفاع التنقل السفلي الثابت (جوال) كي لا تغطيه البطاقة السفلية. */
function bottomNavHeight(): number {
  const nav = document.querySelector('nav[aria-label]');
  if (!(nav instanceof HTMLElement)) return 0;
  const rect = nav.getBoundingClientRect();
  return window.getComputedStyle(nav).position === 'fixed' && rect.top > window.innerHeight / 2 ? rect.height : 0;
}

export function GuideOverlay({
  tourId,
  steps,
  index,
  onPrev,
  onNext,
  onSkip,
  onFinish,
  onMissing,
}: {
  tourId: TourId;
  steps: readonly TourStep[];
  index: number;
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
  onFinish: () => void;
  /** العنصر اختفى (إخفاء/حذف أثناء الجولة): يتخطاه المزوّد باتجاه الحركة الأخيرة. */
  onMissing: () => void;
}) {
  const t = useTranslations('stationOps');
  const reduced = useReducedMotion();
  const step = steps[index];
  const total = steps.length;
  const last = index === total - 1;
  const cardRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [cardSize, setCardSize] = useState({ width: 320, height: 200 });
  const [viewport, setViewport] = useState({ width: 390, height: 844 });
  const [shown, setShown] = useState(false);
  const animateSpot = useRef(false);

  const measure = useCallback(() => {
    const element = targetRef.current;
    setViewport({ width: window.innerWidth, height: window.innerHeight });
    if (!element || !element.isConnected) return;
    const rect = element.getBoundingClientRect();
    setBox({ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 });
  }, []);

  // موضع العنصر: ابحث عنه، مرّره إلى الشاشة، ثم تابع تغيّر التخطيط والتمرير.
  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    const cleanups: Array<() => void> = [];
    setShown(false);
    targetRef.current = null;

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    if (!step.target) {
      setBox(null);
      measure();
      setShown(true);
    } else {
      void waitForTarget(step.target, 700).then((element) => {
        if (cancelled) return;
        if (!element) {
          onMissing();
          return;
        }
        targetRef.current = element;
        if (!hasFixedAncestor(element)) element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
        measure();
        setShown(true);
        window.addEventListener('scroll', schedule, { capture: true, passive: true });
        window.addEventListener('resize', schedule);
        cleanups.push(() => {
          window.removeEventListener('scroll', schedule, { capture: true });
          window.removeEventListener('resize', schedule);
        });
        if (typeof ResizeObserver !== 'undefined') {
          const observer = new ResizeObserver(schedule);
          observer.observe(element);
          cleanups.push(() => observer.disconnect());
        }
        // العنصر قد يُزال أثناء الجولة (تحديث الصفحة/تبدّل الحالة): تحقق دورياً بخفّة.
        const watch = window.setInterval(() => {
          if (targetRef.current && !findTarget(step.target!)) onMissing();
        }, 800);
        cleanups.push(() => window.clearInterval(watch));
      });
    }
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      cleanups.forEach((fn) => fn());
    };
    // `onMissing` يتغيّر بتغيّر الفهرس؛ الاعتماد على الخطوة والحركة كافٍ لإعادة الربط.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id, tourId, reduced, measure]);

  // الانتقال الناعم للـSpotlight بين الخطوات فقط (لا من العدم في أول ظهور).
  useEffect(() => {
    if (box) animateSpot.current = !reduced;
  }, [box, reduced]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    setCardSize((previous) => (Math.abs(previous.height - rect.height) > 1 || Math.abs(previous.width - rect.width) > 1 ? { width: rect.width, height: rect.height } : previous));
  }, [step.id, shown, viewport.width]);

  // نقل الانتباه إلى البطاقة عند كل خطوة (قارئ الشاشة يقرأ العنوان والوصف) دون تمرير الصفحة.
  useEffect(() => {
    if (shown) cardRef.current?.focus({ preventScroll: true });
  }, [step.id, shown]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onSkip();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onSkip]);

  const base = `guide.tour.${tourId}.${step.id}`;
  const title = t(`${base}.title`);
  const body = t(`${base}.body`);
  const mobile = viewport.width < 768;
  const spot = box && step.target;

  // موضع البطاقة.
  const style: React.CSSProperties = {};
  if (!spot) {
    style.top = '50%';
    style.left = '50%';
    style.transform = 'translate(-50%, -50%)';
    style.width = `min(${mobile ? '92vw' : '28rem'}, calc(100vw - ${MARGIN * 2}px))`;
  } else if (mobile) {
    const nav = bottomNavHeight();
    const above = box.top;
    const below = viewport.height - nav - (box.top + box.height);
    const dockBottom = below >= above || below >= cardSize.height + GAP;
    style.left = MARGIN;
    style.right = MARGIN;
    if (dockBottom) style.bottom = `calc(${nav}px + ${MARGIN}px)`;
    else style.top = `calc(env(safe-area-inset-top) + ${MARGIN}px)`;
  } else {
    const width = Math.min(cardSize.width || 360, viewport.width - MARGIN * 2);
    const left = Math.min(Math.max(box.left + box.width / 2 - width / 2, MARGIN), viewport.width - width - MARGIN);
    const spaceBelow = viewport.height - (box.top + box.height);
    if (spaceBelow >= cardSize.height + GAP * 2) style.top = box.top + box.height + GAP;
    else if (box.top >= cardSize.height + GAP * 2) style.top = box.top - cardSize.height - GAP;
    else {
      style.bottom = MARGIN;
    }
    style.left = left;
    style.width = '24rem';
    style.maxWidth = `calc(100vw - ${MARGIN * 2}px)`;
  }

  const motion = reduced ? '' : 'transition-[opacity,transform] duration-200 ease-out';
  const Next = last ? Check : ArrowLeft;

  return (
    <div data-smart-guide="" data-guide-tour={tourId} data-guide-step={step.id} className="pointer-events-none fixed inset-0 z-[70]">
      {spot ? (
        <div
          aria-hidden="true"
          data-guide-spotlight=""
          className="absolute rounded-[14px]"
          style={{
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height,
            boxShadow: `0 0 0 3px var(--primary), 0 0 0 100vmax ${DIM}`,
            transition: reduced || !animateSpot.current ? 'none' : 'top 280ms cubic-bezier(.2,.8,.2,1), left 280ms cubic-bezier(.2,.8,.2,1), width 280ms cubic-bezier(.2,.8,.2,1), height 280ms cubic-bezier(.2,.8,.2,1)',
          }}
        />
      ) : (
        <div aria-hidden="true" data-guide-dim="" className={`absolute inset-0 ${reduced ? '' : 'transition-opacity duration-200'}`} style={{ background: DIM, opacity: shown ? 1 : 0 }} />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby="fo-guide-title"
        aria-describedby="fo-guide-body"
        tabIndex={-1}
        data-guide-card=""
        style={style}
        className={`pointer-events-auto absolute rounded-[18px] border border-border bg-surface p-4 text-text shadow-[0_18px_48px_rgba(12,22,38,0.35)] outline-none ${motion} ${shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'}`}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold text-primary">{t('guide.ui.stepOf', { current: String(index + 1), total: String(total) })}</p>
          <button
            type="button"
            onClick={onSkip}
            className="min-h-11 rounded-[10px] px-2 text-xs font-medium text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('guide.ui.skip')}
          </button>
        </div>
        <div
          role="progressbar"
          aria-label={t('guide.ui.progress')}
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={index + 1}
          className="mt-1 flex gap-1"
        >
          {steps.map((item, position) => (
            <span key={item.id} aria-hidden="true" className={`h-1.5 flex-1 rounded-full ${reduced ? '' : 'transition-colors duration-200'} ${position <= index ? 'bg-primary' : 'bg-border'}`} />
          ))}
        </div>
        <h2 id="fo-guide-title" className="mt-3 text-base font-bold leading-6">{title}</h2>
        <p id="fo-guide-body" className="mt-1.5 text-sm leading-6 text-muted">{body}</p>
        <div className="mt-4 flex gap-2">
          {index > 0 ? (
            <button
              type="button"
              onClick={onPrev}
              className="inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-[13px] border border-[color:var(--fo-control)] text-sm font-semibold text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ArrowRight aria-hidden="true" className="h-4 w-4 ltr:rotate-180" strokeWidth={1.9} />
              {t('guide.ui.previous')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={last ? onFinish : onNext}
            data-guide-next=""
            className="inline-flex min-h-12 flex-[1.4] items-center justify-center gap-1.5 rounded-[13px] bg-[color:var(--fo-cta-bg)] text-sm font-bold text-[color:var(--fo-cta-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            {last ? t('guide.ui.done') : t('guide.ui.next')}
            <Next aria-hidden="true" className={`h-4 w-4 ${last ? '' : 'ltr:rotate-180'}`} strokeWidth={2} />
          </button>
        </div>
      </div>

      <p role="status" aria-live="polite" className="sr-only">{`${t('guide.ui.stepOf', { current: String(index + 1), total: String(total) })}: ${title}`}</p>
    </div>
  );
}
