'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** ترويسة قسم داخل «إعدادات المخزون والمنتجات» — عنوان ووصف وزرّ رجوع للمحور. */
export function SettingsHeader({ title, subtitle }: { title: string; subtitle: string }) {
  const t = useTranslations('inventorySettings');
  const router = useRouter();

  return (
    <div className="flex items-start gap-2">
      <Button asChild
        variant="ghost"
        size="icon"
        aria-label={t('back')}
      ><Link href='/inventory-settings'>
        {/* السهم يشير إلى «الخلف» في RTL — أي إلى اليمين. */}
        <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
      </Link></Button>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-text">{title}</h1>
        <p className="mt-1 text-sm text-muted">{subtitle}</p>
      </div>
    </div>
  );
}
