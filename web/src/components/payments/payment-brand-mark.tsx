'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { CreditCard } from 'lucide-react';
import {
  enabledMethodBrands,
  type PaymentBrandPresentation,
} from '@/lib/payment-brand-registry';

function brandName(brand: PaymentBrandPresentation, locale: string): string {
  return locale === 'ar' ? brand.nameAr : brand.nameEn;
}

/**
 * علامة دفع واحدة. الشعار الرسمي الموثّق فقط (`logo.kind === 'official'`) بلا تلوين ولا قصّ ولا تغيير نسبة؛
 * وإلا (أو عند فشل تحميل الأصل) يظهر الاسم نصاً فقط — لا شعار بديل ولا حرف مرسوم.
 * الاسم نصٌّ ظاهر دائماً، فالصورة زخرفة (`alt=""`).
 */
export function PaymentBrandMark({
  brand,
  withIcon = false,
  className = '',
}: {
  brand: PaymentBrandPresentation;
  /** أيقونة بطاقة عامة (ليست شعاراً) قبل الاسم عند غياب الأصل الرسمي. */
  withIcon?: boolean;
  className?: string;
}) {
  const locale = useLocale();
  const [broken, setBroken] = useState(false);
  const name = brandName(brand, locale);
  const logo = brand.logo.kind === 'official' && !broken ? brand.logo : null;

  return (
    <span className={`inline-flex min-w-0 items-center gap-2 ${className}`} data-testid="payment-brand-mark" data-brand={brand.key}>
      {logo ? (
        <img
          src={logo.src}
          alt=""
          width={logo.width}
          height={logo.height}
          data-mark="logo"
          onError={() => setBroken(true)}
          className="h-6 w-auto shrink-0 object-contain"
        />
      ) : withIcon ? (
        <span aria-hidden data-mark="generic" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted">
          <CreditCard className="h-4 w-4" strokeWidth={1.7} />
        </span>
      ) : null}
      <span className="min-w-0 truncate text-sm font-semibold text-text">{name}</span>
    </span>
  );
}

/**
 * صفّ وسائل الدفع المقبولة. يعرض فقط ما مرّره المستدعي في `enabled` (مدعوم ومفعَّل فعلاً من الخادم) وكان في السجل؛
 * قائمة فارغة/مجهولة ⇒ لا شيء (لا افتراض «نقبل مدى وفيزا» دون تفعيل).
 */
export function PaymentBrandRow({
  enabled,
  label,
  className = '',
}: {
  enabled: readonly string[] | null | undefined;
  /** تسمية مترجمة للمجموعة (قارئ الشاشة). */
  label: string;
  className?: string;
}) {
  // إرشادات Apple: رسالة Apple Pay تُعرض على الأجهزة المدعومة فقط (canMakePayments) — لا تُعرض قبل التحقق على العميل.
  const [applePayDevice, setApplePayDevice] = useState(false);
  useEffect(() => {
    try {
      const session = (window as unknown as { ApplePaySession?: { canMakePayments?: () => boolean } }).ApplePaySession;
      setApplePayDevice(Boolean(session?.canMakePayments?.()));
    } catch {
      setApplePayDevice(false);
    }
  }, []);
  const brands = enabledMethodBrands(enabled).filter((brand) => brand.key !== 'apple_pay' || applePayDevice);
  if (brands.length === 0) return null;
  return (
    <ul role="list" aria-label={label} className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`} data-testid="payment-brand-row">
      {brands.map((brand) => (
        <li key={brand.key}>
          <PaymentBrandMark brand={brand} />
        </li>
      ))}
    </ul>
  );
}
