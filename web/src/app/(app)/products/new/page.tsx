'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { ProductWorkspace } from '@/components/products/product-workspace';

/**
 * غلافٌ رقيقٌ حول `ProductWorkspace` (PR-PROD-UX-1). الوحدات/الباركود
 * المتعدّد/السعر لكل وحدة (PR-PROD-UX-2)، الخيارات/المتغيّرات
 * (PR-PROD-UX-3)، والوسائط/النشر التجاري (PR-PROD-UX-4) كلّها داخل
 * `ProductWorkspace` نفسه اليوم — هذه الصفحة لا تملك أي نسخةٍ ثانية من
 * ذلك المنطق، ودورها الوحيد هو الانتقال إلى قائمة المنتجات بعد نجاح
 * دورة الحفظ الأولى الكاملة (المنتج + الوسائط المُعلَّقة + النشر).
 */
export default function NewProductPage() {
  const t = useTranslations('products');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();

  /** يُستدعى فور نجاح أول `POST /products` **و** أي خطوةٍ حاجبة لاحقة (النشر). */
  async function afterCreated() {
    success(tc('created'));
    router.push('/products');
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('back')}><Link href='/products'>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Link></Button>
        <h1 className="text-xl font-semibold text-text">{t('new_title')}</h1>
      </div>

      <ProductWorkspace
        mode="create"
        onCreated={afterCreated}
        onUpdated={afterCreated}
        cancelHref="/products"
      />
    </div>
  );
}
