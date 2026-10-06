'use client';

import { useLocale } from 'next-intl';
import { useEffect } from 'react';
import { currentUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { installUnsavedNavigationGuard } from '../../unsaved-registry';
import { ProductGiftingWorkspace } from './gifting-workspace';

/**
 * نقطة التركيب في ملف المنتج: تحسم اللغة وصلاحية الكتابة (`products.manage`) هنا كي لا يعرف ملف المنتج شيئاً عن
 * تفاصيل الهدايا. المفتاح `key={productId}` يعيد تهيئة كل الأقسام عند تبديل المنتج.
 */
export function ProductGiftingTab({ productId }: { productId: string }) {
  const locale = useLocale();
  const user = currentUser();
  const canManage = hasPermission(user?.permissions, user?.role, 'products.manage');
  // ملف المنتج خارج غلاف مساحة التجارة: بدون هذا يُسقط أي رابط في الشريط الجانبي المسوّدة بصمت.
  useEffect(() => installUnsavedNavigationGuard(), []);

  return <ProductGiftingWorkspace key={productId} productId={productId} locale={locale} canManage={canManage} />;
}
