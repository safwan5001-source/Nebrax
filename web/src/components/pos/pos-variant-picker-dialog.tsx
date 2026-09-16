'use client';

import { useTranslations } from 'next-intl';
import { PosDialog } from '@/components/pos/pos-dialog';
import { PosProductImage } from '@/components/pos/pos-product-image';

export interface PosVariantPickerOption {
  id: string;
  sku: string | null;
  descriptor: string | null;
  price: string;
  /** VAR-FU-5/GAP-06: غلاف الوسائط المحلول لهذا المتغيّر بعينه (قد يكون
   *  فارغاً للتخزين المشترك، وسائط قيمة الخيار، أو الحصرية للمتغيّر — الأولوية
   *  محسومة خادمياً عبر ProductMediaGalleryService). `undefined`/`null` = لا
   *  وسائط محلولة، يُعرض الاحتياط الحالي (`PosProductImage`) كما هو. */
  image?: { download_url: string } | null;
}

interface Props {
  open: boolean;
  productName: string | null;
  variants: PosVariantPickerOption[];
  onSelect: (variant: PosVariantPickerOption) => void;
  onClose: () => void;
  /** يتبع إعداد `show_product_images` نفسه الذي يحكم بطاقة المنتج — لا صورة
   *  إلزامية، ولا تعارض بين سطحين لنفس الإعداد. */
  showImages?: boolean;
}

/**
 * VAR-POS-1 — أصغر UX ممكن لاختيار متغيّرٍ فعلي: لائحة أزرارٍ بوصف التركيبة
 * وسعرها. لا Configurator، ولا اختيار خيار/قيمة تدريجي — كل المتغيّرات
 * النشطة ظاهرة دفعة واحدة (نفس نمط شبكة المنتجات نفسها). لا يظهر هنا إلا
 * متغيّرٌ نشِط أصلاً (الخادم لا يرسل غيره ضمن `pos_variants`).
 *
 * VAR-FU-5/GAP-06: صورةٌ مصغَّرة (٤٤×٤٤، أهداف لمسٍ كاملة) قبل الوصف مباشرةً
 * — نفس `PosProductImage` وسلسلة احتياطه المستعملة في بطاقة المنتج، فلا شكل
 * جديد ولا انقطاعٍ بصري. أسودٌ/S وأسودٌ/M يتشاركان الصورة نفسها حين يرثانها
 * من قيمة الخيار — الخادم وحده يقرّر ذلك، لا منطق حلٍّ هنا.
 */
export function PosVariantPickerDialog({ open, productName, variants, onSelect, onClose, showImages = true }: Props) {
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
            className="flex min-h-11 items-center gap-3 rounded border border-border px-3 py-2 text-start hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {showImages && (
              <span className="h-11 w-11 shrink-0 overflow-hidden rounded border border-border bg-background">
                <PosProductImage path={variant.image?.download_url} alt={variant.descriptor ?? variant.sku ?? ''} />
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{variant.descriptor ?? variant.sku ?? variant.id}</span>
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
