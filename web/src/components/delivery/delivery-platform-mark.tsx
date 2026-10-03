import { deliveryPlatformMonogram, deliveryPlatformPresentation } from '@/lib/delivery-platform-registry';

/**
 * الاسم دائماً نص ظاهر. الشعار — إن وُجد أصل مرخّص — لا يُلوَّن ولا يُستبدل به الاسم.
 * بغير ذلك: حرف محايد من رموز AWJ، وليس إعادة رسم لشعار المنصة.
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

  return (
    <span className="inline-flex min-w-0 items-center gap-2" data-testid="delivery-platform-mark">
      {known?.logoSrc ? (
        <img src={known.logoSrc} alt="" className="h-8 w-8 shrink-0 object-contain" />
      ) : (
        <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-sm font-bold text-text">
          {monogram}
        </span>
      )}
      <span className="min-w-0 truncate text-sm font-semibold text-text">{label}</span>
    </span>
  );
}
