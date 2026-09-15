'use client';

import { useTranslations } from 'next-intl';
import { PosDialog } from '@/components/pos/pos-dialog';

export interface PosVariantPickerOption {
  id: string;
  sku: string | null;
  descriptor: string | null;
  price: string;
}

interface Props {
  open: boolean;
  productName: string | null;
  variants: PosVariantPickerOption[];
  onSelect: (variant: PosVariantPickerOption) => void;
  onClose: () => void;
}

/**
 * VAR-POS-1 — أصغر UX ممكن لاختيار متغيّرٍ فعلي: لائحة أزرارٍ بوصف التركيبة
 * وسعرها. لا Configurator، ولا اختيار خيار/قيمة تدريجي — كل المتغيّرات
 * النشطة ظاهرة دفعة واحدة (نفس نمط شبكة المنتجات نفسها). لا يظهر هنا إلا
 * متغيّرٌ نشِط أصلاً (الخادم لا يرسل غيره ضمن `pos_variants`).
 */
export function PosVariantPickerDialog({ open, productName, variants, onSelect, onClose }: Props) {
  const t = useTranslations('pos');

  return (
    <PosDialog open={open} onClose={onClose} title={productName ?? t('select_variant')}>
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted">{t('select_variant_hint')}</p>
        {variants.map((variant) => (
          <button
            key={variant.id}
            type="button"
            onClick={() => onSelect(variant)}
            className="flex min-h-11 items-center justify-between rounded border border-border px-3 py-2 text-start hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <span className="truncate text-sm font-medium text-text">{variant.descriptor ?? variant.sku ?? variant.id}</span>
            <span className="shrink-0 text-sm text-muted">{variant.price}</span>
          </button>
        ))}
        {variants.length === 0 ? (
          <p className="text-sm text-muted">{t('no_sellable_variants')}</p>
        ) : null}
      </div>
    </PosDialog>
  );
}
