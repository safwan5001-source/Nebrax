import { useEffect } from 'react';
import { ToastProvider, useToast } from 'awj-design-system-v2';

function FireOnMount() {
  const { success, error } = useToast();
  useEffect(() => {
    success('تم حفظ الفاتورة', 'رقم INV-2026-0042');
    error('فشل الاتصال بالخادم');
  }, [success, error]);
  return null;
}

export function Default() {
  return (
    <ToastProvider>
      <div style={{ minHeight: 160 }} />
      <FireOnMount />
    </ToastProvider>
  );
}
