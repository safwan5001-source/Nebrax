'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { GatewayConnection } from '@/modules/payments/gateways/contract';

/** اتصالات البوابات للمؤسسة (قراءة فقط) لمرشّحات التسويات والتعديلات ونماذجها. فشل التحميل يعيد قائمة فارغة ولا يكسر الشاشة. */
export function useGateways(): { gateways: GatewayConnection[]; loading: boolean } {
  const [gateways, setGateways] = useState<GatewayConnection[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    api<{ data: GatewayConnection[] }>('/payment-gateways')
      .then((res) => { if (live) setGateways(res.data); })
      .catch(() => {})
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);
  return { gateways, loading };
}
