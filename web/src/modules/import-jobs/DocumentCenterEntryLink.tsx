'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useCurrentUser } from '@/lib/use-can';
import { hiddenApplicationKeys, isNavEntryVisible } from '@/components/layout/nav-visibility';

/**
 * رابط دخول من شاشة استيراد المشتريات/المصروفات إلى مركز المستندات (IMP-H5-S6): فاتورة مصوَّرة أو PDF لا يُدخلها جدول بيانات. يظهر بالشرطين نفسيهما اللذين
 * يحكمان عنصر الشريط الجانبي (قدرة `document_center.core` فعّالة + صلاحية `documents.center.view`) فلا يقود إلى طريق مسدود. فشل جلب حالة القدرات لا يُخفيه
 * (القاعدة نفسها في الشريط). المسودة التي ينشئها المركز تدخل بروتوكول منع التكرار نفسه، فلا تتكرر فاتورة مستوردة سلفاً.
 */
export function DocumentCenterEntryLink({ kind }: { kind: 'purchase' | 'expense' }) {
  const t = useTranslations('documentCenterEntry');
  const user = useCurrentUser();
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    api<{ data: Record<string, boolean> }>('/applications/nav-state')
      .then((response) => {
        if (cancelled || Array.isArray(response.data)) return;
        setHidden(hiddenApplicationKeys(response.data));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isNavEntryVisible({ appKey: 'document_center.core', permission: 'documents.center.view' }, hidden, user)) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-background px-3 py-2">
      <FileText className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} />
      <p className="min-w-0 flex-1 text-sm leading-relaxed text-muted">{t(kind === 'purchase' ? 'purchase_hint' : 'expense_hint')}</p>
      <Button asChild variant="outline" size="sm">
        <Link href="/documents">{t('open')}</Link>
      </Button>
    </div>
  );
}
