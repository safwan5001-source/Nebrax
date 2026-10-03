'use client';

import { useState } from 'react';
import { deliveryPlatformMonogram, deliveryPlatformPresentation } from '@/lib/delivery-platform-registry';

/**
 * الاسم دائماً نص ظاهر بجانب الشعار. الأصل الرسمي لا يُلوَّن ولا تُكسر نسبته.
 * الحرف المحايد فقط لمنصة غير معروفة أو عند فشل تحميل الملف.
 */
export function DeliveryPlatformMark({
  platformKey,
  name,
}: {
  platformKey: string | null | undefined;
  name: string;
}) {
  const known = deliveryPlatformPresentation(platformKey);
  const label = name.trim() || known?.nameEn || known?.nameAr || '';
  const monogram = deliveryPlatformMonogram(platformKey, label);
  const identity = `${platformKey ?? ''}|${known?.logoSrc ?? ''}`;
  const [brokenIdentity, setBrokenIdentity] = useState<string | null>(null);
  const src = known?.logoSrc && brokenIdentity !== identity ? known.logoSrc : null;

  return (
    <span className="inline-flex min-w-0 items-center gap-2" data-testid="delivery-platform-mark">
      {src ? (
        <img
          src={src}
          alt=""
          width={512}
          height={512}
          data-mark="logo"
          onError={() => setBrokenIdentity(identity)}
          className="h-8 w-8 shrink-0 object-contain"
        />
      ) : (
        <span
          aria-hidden
          data-mark="monogram"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-sm font-bold text-text"
        >
          {monogram}
        </span>
      )}
      <span className="min-w-0 truncate text-sm font-semibold text-text">{label}</span>
    </span>
  );
}
