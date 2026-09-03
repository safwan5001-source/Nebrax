'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { LockKeyhole, PlugZap } from 'lucide-react';
import { EmptyState, LoadingState } from '@/components/nebrax';
import { currentUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { isDemo } from '@/lib/demo';

/**
 * بوّابة وصول بوابة المطوّرين — **لا تكتفي بإخفاء الواجهة** (§26). كل صفحة تستدعي
 * هذه الطبقة فتُفحَص `developer.view` بمرآة `Rbac::allows` نفسها؛ والخادم يبقى المرجع
 * (كل مسار `/api/developer/*` محروس بـ RBAC وعزل المستأجر). `canManage` يفصل العرض
 * عن الإجراءات (`developer.manage`) فلا يظهر زرٌّ يردّه المسار 403.
 *
 * الربط بـ `mounted`: هذه صفحات `use client` يعرضها Next خادمياً أيضاً حيث لا
 * `localStorage`؛ فنعرض هيكلاً حتى تُركَّب الجلسة، تفادياً لوميض «ممنوع» ثم المحتوى.
 */
export interface DeveloperAccess {
  mounted: boolean;
  canView: boolean;
  canManage: boolean;
  demo: boolean;
}

export function useDeveloperAccess(): DeveloperAccess {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const user = currentUser();
  return {
    mounted,
    canView: hasPermission(user?.permissions, user?.role, 'developer.view'),
    canManage: hasPermission(user?.permissions, user?.role, 'developer.manage'),
    demo: isDemo(),
  };
}

/** حالة «ممنوع» موحّدة — لمن لا يملك `developer.view` (وصولٌ مباشر رغم إخفاء الشريط). */
export function DeveloperForbidden() {
  const t = useTranslations('developer.common');
  return <EmptyState icon={LockKeyhole} title={t('forbidden')} description={t('forbiddenHint')} />;
}

/** حالة «غير متاح في المعاينة» — أدوات المطوّرين تعمل على الحساب الحقيقي فقط (§39: لا بيانات وهمية). */
export function DeveloperDemoUnavailable() {
  const t = useTranslations('developer.common');
  return <EmptyState icon={PlugZap} title={t('demoUnavailable')} description={t('demoUnavailableHint')} />;
}

/**
 * غلاف صفحة يحرس العرض: يعرض هيكلاً قبل التركيب، ثم «ممنوع» لمن لا يملك العرض،
 * ثم المحتوى. `demoGate` يفعّل حالة المعاينة للصفحات التي تجلب بيانات حقيقية.
 */
export function DeveloperGate({
  access,
  demoGate = false,
  children,
}: {
  access: DeveloperAccess;
  demoGate?: boolean;
  children: React.ReactNode;
}) {
  if (!access.mounted) return <LoadingState rows={5} />;
  if (!access.canView) return <DeveloperForbidden />;
  if (demoGate && access.demo) return <DeveloperDemoUnavailable />;
  return <>{children}</>;
}
