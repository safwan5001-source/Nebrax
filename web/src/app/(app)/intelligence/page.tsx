'use client';

import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/nebrax';
import { IntelligenceCanvas } from '@/components/intelligence/intelligence-canvas';
import { useCan } from '@/lib/use-can';

export default function IntelligencePage() {
  const t = useTranslations('intelligence.notice');
  const { can, hydrated } = useCan();
  if (!hydrated) return null;
  // بلا صلاحية الاستخدام لا نُرسل أي طلب: الحالة محسومة محلياً من الدور المخزَّن، والخادم يعيد التحقق عند أي نداء.
  if (!can('ai.assistant.use')) {
    return <EmptyState titleAs="h1" title={t('permission_denied.title')} description={t('permission_denied.body')} />;
  }
  return <IntelligenceCanvas />;
}
