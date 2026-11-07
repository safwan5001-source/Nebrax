'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useStationOps } from '../context';
import { GuideOverlay } from './guide-overlay';
import { buildPlan } from './plan';
import { autoStartAllowed, currentRecord, progressKey, readProgress, withRecord, writeProgress, type ProgressMap, type TourRecord, type TourStatus } from './progress';
import { TOURS, getTour, tourAvailable, tourForPathname, type Tour, type TourId, type TourStep } from './tours';

/**
 * AWJ Smart Guide — المزوّد: يملك حالة الجولة النشطة وتقدّم المستخدم، ويبدأ الجولة الترحيبية تلقائياً عند أول دخول.
 *
 * - التقدّم لكل (مؤسسة، مستخدم) على هذا المتصفح (`progress.ts`)؛ تبديل الموظف على جهاز مشترك لا يرث جولات الآخر.
 * - تغيّر الشاشة يوقف الجولة النشطة ويحفظها «قيد التقدم» (تُستأنف من المركز)؛ لا تنتقل الجولة بين الشاشات من تلقاء نفسها.
 * - لا يضغط ولا يرسل ولا يقرأ الخادم: يعمل على العرض وحده.
 */
export type TourView = { tour: Tour; status: TourStatus | 'new'; step: number };

interface GuideApi {
  /** الجولات التي تحق للمستخدم رؤيتها (بالصلاحيات) مع حالتها. */
  tours: readonly TourView[];
  /** بدء/استئناف/إعادة جولة. false = لا تُشغَّل الآن (شاشتها تحتاج معرّفاً، أو لا عناصر جاهزة). */
  start: (id: TourId, options?: { resume?: boolean }) => Promise<boolean>;
  activeId: TourId | null;
  /** جولة هذه الشاشة (إن وُجدت وتحق للمستخدم) لزر «ابدأ جولة هذه الشاشة». */
  forPathname: (pathname: string) => Tour | undefined;
}

const GuideContext = createContext<GuideApi | null>(null);

export function useSmartGuide(): GuideApi | null {
  return useContext(GuideContext);
}

interface Active { tour: Tour; steps: readonly TourStep[]; index: number }

const AUTO_DELAY_MS = 900;

export function GuideProvider({ children }: { children: ReactNode }) {
  const { viewer, can } = useStationOps();
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const key = progressKey(viewer.tenant_id, viewer.id);
  const [progress, setProgress] = useState<ProgressMap>({});
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const [active, setActive] = useState<Active | null>(null);
  const runRef = useRef<AbortController | null>(null);
  const pendingRef = useRef<TourId | null>(null);
  const autoTriedRef = useRef<string | null>(null);
  const directionRef = useRef<1 | -1>(1);
  const canRef = useRef(can);
  canRef.current = can;

  // قراءة التقدّم عند تغيّر المستخدم/المؤسسة؛ لا تسرب بين الموظفين.
  useEffect(() => {
    runRef.current?.abort();
    setActive(null);
    setProgress(readProgress(key));
    setHydratedKey(key);
  }, [key]);

  const save = useCallback((tour: Tour, status: TourStatus, step: number) => {
    const record: TourRecord = { version: tour.version, status, step, at: new Date().toISOString() };
    setProgress((previous) => {
      const next = withRecord(previous, tour.id, record);
      writeProgress(key, next);
      return next;
    });
  }, [key]);

  const begin = useCallback(async (tour: Tour, startAt: number): Promise<boolean> => {
    runRef.current?.abort();
    const controller = new AbortController();
    runRef.current = controller;
    const steps = await buildPlan(tour, (permission) => canRef.current(permission), controller.signal);
    if (controller.signal.aborted || steps.length === 0) return false;
    const index = Math.min(Math.max(startAt, 0), steps.length - 1);
    directionRef.current = 1;
    setActive({ tour, steps, index });
    save(tour, 'in_progress', index);
    return true;
  }, [save]);

  const start = useCallback(async (id: TourId, options?: { resume?: boolean }): Promise<boolean> => {
    const tour = getTour(id);
    if (!tour || !tourAvailable(tour, (permission) => canRef.current(permission))) return false;
    if (!tour.route.test(pathname.replace(/\/+$/, '') || '/')) {
      if (tour.dynamic) return false;
      pendingRef.current = id; // تبدأ عند وصول المستخدم إلى شاشتها
      router.push(tour.entry);
      return true;
    }
    const record = currentRecord(progress, id, tour.version);
    return begin(tour, options?.resume && record?.status === 'in_progress' ? record.step : 0);
  }, [begin, pathname, progress, router]);

  // تغيّر الشاشة: أوقف الجولة النشطة (محفوظة قيد التقدم)، وابدأ جولة كانت بانتظار وصول المستخدم.
  useEffect(() => {
    setActive((current) => (current && !current.tour.route.test(pathname.replace(/\/+$/, '') || '/') ? null : current));
    const pending = pendingRef.current ? getTour(pendingRef.current) : undefined;
    if (pending && pending.route.test(pathname.replace(/\/+$/, '') || '/')) {
      pendingRef.current = null;
      void begin(pending, 0);
    }
  }, [pathname, begin]);

  // الجولة الترحيبية عند أول دخول: مرة واحدة لكل مستخدم، بعد استقرار الشاشة.
  useEffect(() => {
    if (hydratedKey !== key || active || autoTriedRef.current === key) return;
    const welcome = TOURS.find((tour) => tour.auto);
    if (!welcome || !welcome.route.test(pathname.replace(/\/+$/, '') || '/')) return;
    if (currentRecord(progress, welcome.id, welcome.version)) return;
    if (!tourAvailable(welcome, (permission) => canRef.current(permission)) || !autoStartAllowed()) return;
    const timer = window.setTimeout(() => {
      autoTriedRef.current = key;
      void begin(welcome, 0);
    }, AUTO_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [hydratedKey, key, active, pathname, progress, begin]);

  useEffect(() => () => runRef.current?.abort(), []);

  const move = useCallback((delta: 1 | -1) => {
    directionRef.current = delta;
    setActive((current) => {
      if (!current) return current;
      const index = Math.min(Math.max(current.index + delta, 0), current.steps.length - 1);
      save(current.tour, 'in_progress', index);
      return { ...current, index };
    });
  }, [save]);

  const finish = useCallback(() => {
    setActive((current) => {
      if (current) save(current.tour, 'completed', current.steps.length - 1);
      return null;
    });
  }, [save]);

  const skip = useCallback(() => {
    setActive((current) => {
      if (current) save(current.tour, 'skipped', current.index);
      return null;
    });
  }, [save]);

  const missing = useCallback(() => {
    // عنصر اختفى أثناء الجولة: تُحذف خطوته من الخطة (فيبقى العدّاد صادقاً) ثم تُعرض الخطوة التالية باتجاه الحركة الأخيرة.
    setActive((current) => {
      if (!current) return current;
      const steps = current.steps.filter((_, position) => position !== current.index);
      if (steps.length === 0) return null;
      const index = directionRef.current === 1 ? current.index : current.index - 1;
      if (index >= steps.length) {
        save(current.tour, 'completed', steps.length - 1);
        return null;
      }
      const clamped = Math.max(0, index);
      save(current.tour, 'in_progress', clamped);
      return { ...current, steps, index: clamped };
    });
  }, [save]);

  const api = useMemo<GuideApi>(() => ({
    tours: TOURS.filter((tour) => tourAvailable(tour, can)).map((tour) => {
      const record = currentRecord(progress, tour.id, tour.version);
      return { tour, status: record?.status ?? 'new', step: record?.step ?? 0 };
    }),
    start,
    activeId: active?.tour.id ?? null,
    forPathname: (path) => {
      const tour = tourForPathname(path);
      return tour && tourAvailable(tour, can) ? tour : undefined;
    },
  }), [active, can, progress, start]);

  return (
    <GuideContext.Provider value={api}>
      {children}
      {active ? (
        <GuideOverlay
          key={active.tour.id}
          tourId={active.tour.id}
          steps={active.steps}
          index={active.index}
          onPrev={() => move(-1)}
          onNext={() => move(1)}
          onSkip={skip}
          onFinish={finish}
          onMissing={missing}
        />
      ) : null}
    </GuideContext.Provider>
  );
}
