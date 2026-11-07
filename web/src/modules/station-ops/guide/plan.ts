import { stepPermitted, type Tour, type TourStep } from './tours';

/**
 * بناء خطة الجولة وقت التشغيل: خطوات يسمح بها الصلاحيات، وعناصرها **موجودة وظاهرة** الآن في الصفحة.
 * العنصر المخفي/المحذوف/غير المحمَّل بعد لا يُشرح (يُتخطّى) — لا بطاقة تشير إلى فراغ. دوال بلا آثار جانبية على الصفحة.
 */
export function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  if (element.getClientRects().length === 0) return false;
  const style = window.getComputedStyle(element);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

/**
 * مرساة اختبار: jsdom لا يحسب التخطيط (`getClientRects` فارغة دائماً)، والاختبارات كانت تعدّل نماذج DOM الأولية فتسرّب إلى ملفات أخرى
 * في العملية نفسها. بدلاً من ذلك تستبدل الاختبارات هذه الدالة وتستعيدها؛ الإنتاج دائماً `isVisible`.
 */
export const visibility: { check: (element: Element) => boolean } = { check: isVisible };

/** أول عنصر ظاهر يطابق المحدِّد (قد يطابق المحدِّد عناصر مخفية قبل الظاهر). */
export function findTarget(selector: string, root: ParentNode = document): HTMLElement | null {
  let list: NodeListOf<Element>;
  try {
    list = root.querySelectorAll(selector);
  } catch {
    return null;
  }
  for (const element of list) if (visibility.check(element)) return element as HTMLElement;
  return null;
}

export function waitForTarget(selector: string, timeoutMs: number, signal?: AbortSignal): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (signal?.aborted) return resolve(null);
      const found = findTarget(selector);
      if (found) return resolve(found);
      if (Date.now() - started >= timeoutMs) return resolve(null);
      window.setTimeout(tick, 100);
    };
    tick();
  });
}

export const FIRST_TARGET_WAIT_MS = 2500;
export const OTHER_TARGET_WAIT_MS = 250;

/**
 * الخطوات المسموحة ثم الموجودة: أول خطوة ذات هدف تنتظر تحميل الشاشة (بيانات الخادم)، والبقية تنتظر وقتاً قصيراً.
 * خطة بلا أي خطوة مبرَزة لجولة تعرّف عناصر ⇒ فارغة (لا جولة وسطية بلا ما تشرحه).
 */
export async function buildPlan(tour: Tour, can: (permission: string) => boolean, signal?: AbortSignal): Promise<TourStep[]> {
  const permitted = tour.steps.filter((step) => stepPermitted(step, can));
  const plan: TourStep[] = [];
  let firstTargetSeen = false;
  let anchored = 0;
  for (const step of permitted) {
    if (signal?.aborted) return [];
    if (!step.target) {
      plan.push(step);
      continue;
    }
    const found = await waitForTarget(step.target, firstTargetSeen ? OTHER_TARGET_WAIT_MS : FIRST_TARGET_WAIT_MS, signal);
    firstTargetSeen = true;
    if (found) {
      plan.push(step);
      anchored += 1;
    }
  }
  const definesTargets = tour.steps.some((step) => step.target);
  return definesTargets && anchored === 0 ? [] : plan;
}
