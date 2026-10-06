'use client';

import { useLocale } from 'next-intl';
import { currentUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { ProductGiftingWorkspace } from './gifting-workspace';

/**
 * نقطة التركيب في ملف المنتج: تحسم اللغة وصلاحية الكتابة (`products.manage`) هنا كي لا يعرف ملف المنتج شيئاً عن
 * تفاصيل الهدايا. المفتاح `key={productId}` يعيد تهيئة كل الأقسام عند تبديل المنتج.
 */
export function ProductGiftingTab({ productId }: { productId: string }) {
  const locale = useLocale();
  const user = currentUser();
  const canManage = hasPermission(user?.permissions, user?.role, 'products.manage');

  return <ProductGiftingWorkspace key={productId} productId={productId} locale={locale} canManage={canManage} />;
}
