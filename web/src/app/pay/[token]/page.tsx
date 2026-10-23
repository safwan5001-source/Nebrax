'use client';

import { useParams } from 'next/navigation';
import { PayLinkPage } from '@/modules/pay-link/PayLinkPage';

// صفحة عامة خارج هيكل `(app)`: لا مصادقة ولا قائمة. الرمز في المسار هو القدرة الوحيدة (انظر `lib/pay-link.ts`).
export default function PayPage() {
  const params = useParams<{ token: string }>();
  return <PayLinkPage token={String(params?.token ?? '')} />;
}
