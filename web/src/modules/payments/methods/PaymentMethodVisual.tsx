'use client';

import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { fetchImageUrl } from '@/lib/api';
import { cn } from '@/lib/utils';
import { defaultIconFor, logoPath, resolveVisual, type PaymentMethodVisualFields } from './visual';

/** كاش بالجلسة: مفتاحه المسار مع نسخة `updated_at`، فاستبدال الشعار يُجلب من جديد وبقية الشاشات لا تعيد الجلب. */
const logoCache = new Map<string, Promise<string | null>>();
/** للاختبارات فقط: يفرّغ كاش الشعارات بين الحالات. */
export function clearPaymentMethodLogoCache() {
  for (const pending of logoCache.values()) pending.then((url) => { if (url) URL.revokeObjectURL(url); });
  logoCache.clear();
}
function loadLogo(path: string): Promise<string | null> {
  let hit = logoCache.get(path);
  if (!hit) {
    hit = fetchImageUrl(path).catch(() => null);
    logoCache.set(path, hit);
    hit.then((url) => {
      if (url === null) { logoCache.delete(path); return; }
      // نسخة أحدث لنفس الطريقة (استُبدل الشعار): الـBlob URL القديم لم يعد يُطلب، فيُحرَّر ويُزال من الكاش.
      const methodKey = path.split('?')[0];
      for (const [other, pending] of logoCache) {
        if (other !== path && other.split('?')[0] === methodKey) {
          logoCache.delete(other);
          pending.then((old) => { if (old) URL.revokeObjectURL(old); });
        }
      }
    });
  }
  return hit;
}

interface Props {
  method: PaymentMethodVisualFields;
  /** كلاس الحجم/اللون للأيقونة الافتراضية (يُستعمل كما كان في كل شاشة). */
  className?: string;
  /** كلاس لون الأيقونة الافتراضية حين لا لون مختاراً (مثلاً حالة التحديد في POS). */
  defaultIconClassName?: string;
  /** أيقونة الافتراضي حين لا تخصيص (الافتراضي: نقد/بنك كما في POS؛ القائمة تمرّر CreditCard القديمة). */
  defaultIcon?: LucideIcon;
  /** حجم الصورة بالبكسل (مربع). */
  imageSize?: number;
}

/**
 * عارض بصري مشترك لطريقة الدفع: أيقونة Lucide بلون المستخدم، أو شعار مرفوع (بلا تلوين)، أو الافتراضي القديم.
 * أي أصل مفقود/تالف/غير متاح يسقط إلى الافتراضي. اللون بيانات مستخدم تُتحقق بصيغة #RRGGBB ثم تُمرَّر كخاصية `color` فقط.
 */
export function PaymentMethodVisual({ method, className = 'h-4 w-4', defaultIconClassName = 'text-muted', defaultIcon, imageSize = 20 }: Props) {
  const decision = resolveVisual(method);
  const path = decision.kind === 'image' ? logoPath(method) : null;
  const [src, setSrc] = useState<{ path: string; url: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    loadLogo(path).then((url) => {
      if (cancelled) return;
      if (url) setSrc({ path, url }); else setFailed(path);
    });
    return () => { cancelled = true; };
  }, [path]);

  if (decision.kind === 'image' && path && failed !== path) {
    const ready = src?.path === path ? src.url : null;
    return (
      <span className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm" style={{ width: imageSize, height: imageSize }} data-testid="payment-method-visual-image" aria-hidden>
        {ready ? <img src={ready} alt="" width={imageSize} height={imageSize} className="h-full w-full object-contain" onError={() => setFailed(path)} /> : <span className="h-full w-full animate-pulse rounded-sm bg-muted" />}
      </span>
    );
  }

  if (decision.kind === 'icon') {
    const Icon = decision.icon;
    return <Icon className={cn(className, !decision.color && defaultIconClassName)} style={decision.color ? { color: decision.color } : undefined} strokeWidth={1.7} data-testid="payment-method-visual-icon" aria-hidden />;
  }

  const Fallback = defaultIcon ?? defaultIconFor(method.settlement_type);
  return <Fallback className={cn(className, defaultIconClassName)} strokeWidth={1.7} data-testid="payment-method-visual-default" aria-hidden />;
}
