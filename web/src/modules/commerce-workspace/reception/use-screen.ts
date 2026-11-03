'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * COPS-H3-5 — إبقاء الشاشة مضاءة (Screen Wake Lock) وملء الشاشة. **تحسين لا ضمان**: يحرّر المتصفح القفل عند إخفاء التبويب وقد يرفضه الجهاز لتوفير البطارية،
 * ودعم Safari/iOS يختلف بالإصدار — لذا نقيس القدرة وقت التشغيل ولا نعد بشيء، ونُظهر الحالة الفعلية (مفعّل/مرفوض/أُوقف) بنص صريح.
 * الطلب يبدأ بنقرة المستخدم دائماً (لا طلب تلقائي عند الفتح)، ويُعاد تلقائياً عند عودة الصفحة للظهور إن كان مطلوباً.
 */
export type WakeLockState = 'unsupported' | 'off' | 'active' | 'denied' | 'released';

interface WakeLockSentinelLike {
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
  removeEventListener?: (type: 'release', listener: () => void) => void;
}
interface WakeLockLike {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>;
}

function wakeLockApi(): WakeLockLike | null {
  if (typeof navigator === 'undefined') return null;
  const api = (navigator as unknown as { wakeLock?: WakeLockLike }).wakeLock;

  return api && typeof api.request === 'function' ? api : null;
}

export function useWakeLock(): { state: WakeLockState; toggle: () => void } {
  const [state, setState] = useState<WakeLockState>('off');
  const wanted = useRef(false);
  const sentinel = useRef<WakeLockSentinelLike | null>(null);
  const requesting = useRef(false);

  useEffect(() => {
    if (wakeLockApi() === null) setState('unsupported');
  }, []);

  const acquire = useCallback(async () => {
    const api = wakeLockApi();
    if (api === null || requesting.current || sentinel.current !== null) return;
    requesting.current = true;
    try {
      const lock = await api.request('screen');
      if (!wanted.current) {
        // أُلغي الطلب أثناء الانتظار: لا نترك قفلاً يتيماً.
        await lock.release().catch(() => undefined);

        return;
      }
      sentinel.current = lock;
      lock.addEventListener('release', () => {
        if (sentinel.current === lock) sentinel.current = null;
        if (wanted.current) setState('released');
      });
      setState('active');
    } catch {
      wanted.current = false;
      setState('denied');
    } finally {
      requesting.current = false;
    }
  }, []);

  const release = useCallback(async () => {
    const lock = sentinel.current;
    sentinel.current = null;
    if (lock) await lock.release().catch(() => undefined);
  }, []);

  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && wanted.current && sentinel.current === null) void acquire();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      wanted.current = false;
      void release();
    };
  }, [acquire, release]);

  const toggle = useCallback(() => {
    if (wakeLockApi() === null) return;
    if (wanted.current) {
      wanted.current = false;
      void release();
      setState('off');

      return;
    }
    wanted.current = true;
    void acquire();
  }, [acquire, release]);

  return { state, toggle };
}

type FullscreenDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FullscreenEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export type FullscreenState = 'unsupported' | 'off' | 'on' | 'denied';

/** ملء الشاشة للصفحة كلها (documentElement) كي تبقى حوارات الإجراءات المرسومة على body ظاهرة. */
export function useFullscreen(): { state: FullscreenState; toggle: () => void } {
  const [state, setState] = useState<FullscreenState>('off');

  useEffect(() => {
    const doc = document as FullscreenDoc;
    const supported = doc.fullscreenEnabled === true || doc.webkitFullscreenEnabled === true;
    if (!supported) {
      setState('unsupported');

      return;
    }
    const sync = (): void => setState(doc.fullscreenElement || doc.webkitFullscreenElement ? 'on' : 'off');
    sync();
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);

    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  const toggle = useCallback(() => {
    const doc = document as FullscreenDoc;
    const root = document.documentElement as FullscreenEl;
    const active = Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
    try {
      const result = active
        ? (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.())
        : (root.requestFullscreen?.() ?? root.webkitRequestFullscreen?.());
      Promise.resolve(result).catch(() => setState('denied'));
    } catch {
      setState('denied');
    }
  }, []);

  return { state, toggle };
}
