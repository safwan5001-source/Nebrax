import { cn } from '@/lib/utils';
import { FUEL_ICON_NATIVE, FUEL_ICON_SMALL, fuelIconLabel, fuelIconSources, type FuelIconId } from './registry';

/**
 * AWJ Fuel Icons V2 — مكوّن العرض المشترك (أصول مشتركة، بلا هوية تصميم خاصة بتطبيق).
 *
 * - الرسم الأصلي لا يُلوَّن ولا يُدار ولا يُعكس (أرقام 91/95 ورسم الفوهة لا تُقلب في RTL).
 * - الألوان من متغيّرات التطبيق المضيف وحده: `--awj-fuel-icon-plate` (لوح خلف الرسم) — يعرّفه كل نظام تصميم في نطاقه
 *   من رموزه الخاصة. غيابه = رموز التطبيق الدلالية نفسها (`--text` للوح الداكن، `--background` لـ`always`) — بلا ألوان خام.
 * - اللوح: `auto` (الافتراضي) = في السمة الداكنة فقط (تضيع العناصر الكحلية وتظهر هالات الحواف الفاتحة من استخراج JPEG على
 *   خلفية داكنة)؛ `always` = دائماً؛ `never` = بلا لوح.
 * - زخرفي افتراضياً (`alt=""` + `aria-hidden`)؛ يُعرَّف بنص حين يُمرَّر `label` أو `labelled` مع اللغة. النص الجاور هو المرجع
 *   في الشاشات، فلا تكرار لقارئ الشاشة.
 * - `size` = عرض الصندوق بالبكسل (النسبة 5:4 ثابتة). تحت 32px تضيع التفاصيل الدقيقة — استعمل ≥ 32 للعمل اليومي.
 */

export type FuelIconPlate = 'auto' | 'always' | 'never';

export interface FuelIconProps {
  id: FuelIconId;
  /** عرض الصندوق px (الارتفاع = 0.8×). الافتراضي 40. */
  size?: number;
  plate?: FuelIconPlate;
  /** نص بديل صريح؛ يجعل الأيقونة معرَّفة لقارئ الشاشة. */
  label?: string;
  /** يستعمل تسمية السجل (ar/en) حين لا يوجد `label`. */
  labelled?: boolean;
  locale?: string;
  className?: string;
}

const PLATE_CLASS: Record<FuelIconPlate, string> = {
  // الحشوة بالبكسل من `size` (متغيّر `--fi-pad`) لا بنسبة مئوية: النسبة تُحسب من عرض الأب فتسحق الرسم في الصفوف العريضة.
  auto: 'dark:bg-[var(--awj-fuel-icon-plate,var(--text))] dark:p-[var(--fi-pad)]',
  always: 'bg-[var(--awj-fuel-icon-plate,var(--background))] p-[var(--fi-pad)]',
  never: '',
};

export function FuelIcon({ id, size = 40, plate = 'auto', label, labelled = false, locale = 'en', className }: FuelIconProps) {
  const { full, small } = fuelIconSources(id);
  const alt = label ?? (labelled ? fuelIconLabel(id, locale) : '');
  const width = Math.round(size);
  const height = Math.round(size * (FUEL_ICON_NATIVE.height / FUEL_ICON_NATIVE.width));
  return (
    <span
      data-fuel-icon={id}
      data-plate={plate}
      aria-hidden={alt ? undefined : true}
      style={{ width, height, ['--fi-pad' as string]: `${Math.max(2, Math.round(width * 0.06))}px` }}
      className={cn('inline-block shrink-0 box-border overflow-hidden rounded-[18%] align-middle leading-none [transform:none]', PLATE_CLASS[plate], className)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- أصول ثابتة معتمدة بمقاسين جاهزين (srcSet)؛ next/image يعيد ترميزها فيمسّ الرسم الأصلي */}
      <img
        src={full}
        srcSet={`${small} ${FUEL_ICON_SMALL.width}w, ${full} ${FUEL_ICON_NATIVE.width}w`}
        sizes={`${width}px`}
        width={FUEL_ICON_NATIVE.width}
        height={FUEL_ICON_NATIVE.height}
        alt={alt}
        loading="lazy"
        decoding="async"
        draggable={false}
        className="block h-full w-full select-none object-contain"
      />
    </span>
  );
}
