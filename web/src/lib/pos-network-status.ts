'use client';

import { useEffect, useState } from 'react';

/** حالة الشبكة للمتصفح — عرض وإنفاذ خفيف فقط؛ ليست طابور offline. */
export function usePosNetworkStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(typeof navigator === 'undefined' || navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  return online;
}
