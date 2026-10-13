import { useEffect, useState } from 'react';
import { msUntilNextUtcMidnight, todayIsoDate } from './price-status';

/**
 * تاريخ اليوم (UTC) كحالة: يتجدد عند منتصف الليل UTC وعند عودة التبويب للظهور، فلا تبقى حالة
 * «مجدولة/سارية» المشتقة من التاريخ عالقة على يوم سابق في تبويب يبقى مفتوحاً (جهاز نائم أو لوحة مراقبة).
 */
export function useToday(): string {
  const [today, setToday] = useState(() => todayIsoDate());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => setToday(todayIsoDate());
    const schedule = () => {
      // +1s لتفادي الاستيقاظ قبل الحد بجزء من الثانية؛ المؤقتات الطويلة تبقى أقل بكثير من حد setTimeout.
      timer = setTimeout(() => {
        refresh();
        schedule();
      }, msUntilNextUtcMidnight() + 1000);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refresh();
        clearTimeout(timer);
        schedule();
      }
    };
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return today;
}
