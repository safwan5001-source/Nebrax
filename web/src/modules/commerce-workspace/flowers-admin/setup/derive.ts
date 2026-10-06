/**
 * FLOWERS-H2-11 / H2-12 — اشتقاق حالة الإعداد وما ينقص وأين يُعالَج. **لا علَم إتمام مخزَّن**: الحالة الأساسية من
 * `vertical-setup` (الخادم يشتقّها من الإعداد الفعلي)، وتُستكمل أسباب النقص من مستندات الإدارة الحقيقية نفسها
 * (سياسة الإهداء، الجدولة، مخزن التنفيذ) متى قُرئت. فشل قراءة مستندٍ يعني «لا تفسير إضافي» لا اختلاق سبب.
 * كل وجهة رابطٌ لشاشةٍ موجودة فعلاً؛ لا «غير قابل للتطبيق» إلا حيث يثبته العقد (لا حالة كهذه اليوم).
 */

import type { FulfillmentDocument } from '../fulfillment';
import type { GiftPolicy } from '../gift-settings';
import type { ScheduleDocument } from '../delivery-schedule';
import type { VerticalSetup } from '@/modules/commerce-workspace/vertical-setup';

export type SetupGroupId = 'catalog' | 'gifting' | 'delivery' | 'products' | 'presentation';

export const SETUP_GROUP_ORDER: readonly SetupGroupId[] = ['catalog', 'gifting', 'delivery', 'products', 'presentation'];

export type MissingReason =
  | 'no_values'
  | 'gift_off'
  | 'schedule_off'
  | 'no_windows'
  | 'needs_scheduling'
  | 'no_warehouse'
  | 'warehouse_inactive'
  | 'no_products'
  | 'no_section';

export type SetupStepState = 'configured' | 'not_configured';

export type SetupStep = {
  /** مفتاح القدرة من الخادم (`occasions`، `gift_message`…). */
  key: string;
  group: SetupGroupId;
  state: SetupStepState;
  /** عدّاد الخادم (قيم نشطة، منتجات مهيّأة، فترات…). */
  count: number;
  /** سبب/أسباب النقص بالترتيب الأنفع للتاجر؛ فارغة حين `configured` أو حين لا تفسير متاحاً. */
  missing: MissingReason[];
  /** الشاشة التي تعالج النقص (أو تدير الإعداد إن اكتمل). */
  href: string;
  /** وجهة المنتج تحتاج اختيار منتج أولاً. */
  needsProduct: boolean;
};

export type SetupInputs = {
  setup: VerticalSetup;
  gift: GiftPolicy | null;
  schedule: ScheduleDocument | null;
  fulfillment: FulfillmentDocument | null;
};

const GROUP_OF: Record<string, SetupGroupId> = {
  occasions: 'catalog',
  recipients: 'catalog',
  gift_message: 'gifting',
  delivery_scheduling: 'delivery',
  same_day_delivery: 'delivery',
  personalization: 'products',
  add_ons: 'products',
  structured_content: 'products',
  vertical_sections: 'presentation',
};

/** ترتيب العرض داخل المجموعة الواحدة. */
const ORDER = ['occasions', 'recipients', 'gift_message', 'delivery_scheduling', 'same_day_delivery', 'personalization', 'add_ons', 'structured_content', 'vertical_sections'];

const activeWindows = (schedule: ScheduleDocument) => schedule.slots.filter((slot) => slot.isActive).length;

function missingFor(key: string, state: SetupStepState, { gift, schedule, fulfillment }: SetupInputs): MissingReason[] {
  if (state === 'configured') return [];
  switch (key) {
    case 'occasions':
    case 'recipients':
      return ['no_values'];
    case 'gift_message':
      return gift && !gift.enabled ? ['gift_off'] : [];
    case 'delivery_scheduling':
      if (!schedule) return [];
      if (!schedule.settings.enabled) return ['schedule_off'];
      return activeWindows(schedule) === 0 ? ['no_windows'] : [];
    case 'same_day_delivery': {
      if (!schedule) return [];
      const reasons: MissingReason[] = [];
      if (!schedule.settings.enabled) reasons.push('needs_scheduling');
      else if (activeWindows(schedule) === 0) reasons.push('no_windows');
      if (fulfillment) {
        if (fulfillment.current === null) reasons.push('no_warehouse');
        else if (!fulfillment.current.isActive) reasons.push('warehouse_inactive');
      }

      return reasons;
    }
    case 'personalization':
    case 'add_ons':
    case 'structured_content':
      return ['no_products'];
    case 'vertical_sections':
      return ['no_section'];
    default:
      return [];
  }
}

function hrefFor(key: string, missing: readonly MissingReason[]): string {
  switch (key) {
    case 'occasions':
    case 'recipients':
      return '/commerce/merchandising';
    case 'gift_message':
      return '/commerce/gifting';
    case 'delivery_scheduling':
      return missing.includes('no_windows') ? '/commerce/delivery?tab=windows' : '/commerce/delivery?tab=rules';
    case 'same_day_delivery':
      if (missing.includes('no_warehouse') || missing.includes('warehouse_inactive')) return '/commerce/delivery?tab=fulfilment';
      if (missing.includes('no_windows')) return '/commerce/delivery?tab=windows';
      return '/commerce/delivery?tab=rules';
    case 'personalization':
    case 'add_ons':
    case 'structured_content':
      return '/products';
    case 'vertical_sections':
      return '/commerce/appearance';
    default:
      return '/commerce';
  }
}

/** خطوات الإعداد للمتجر بترتيب العرض. مفتاح مجهول من الخادم يُهمَل (لا شاشة له ولا مجموعة). */
export function deriveSetupSteps(inputs: SetupInputs): SetupStep[] {
  const known = inputs.setup.items.filter((item) => GROUP_OF[item.key] !== undefined);

  return known
    .map((item): SetupStep => {
      const state: SetupStepState = item.state === 'configured' ? 'configured' : 'not_configured';
      const missing = missingFor(item.key, state, inputs);

      return {
        key: item.key,
        group: GROUP_OF[item.key],
        state,
        count: item.count,
        missing,
        href: hrefFor(item.key, missing),
        needsProduct: GROUP_OF[item.key] === 'products',
      };
    })
    .sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
}

export function groupSteps(steps: readonly SetupStep[]): { group: SetupGroupId; steps: SetupStep[] }[] {
  return SETUP_GROUP_ORDER.map((group) => ({ group, steps: steps.filter((s) => s.group === group) })).filter((g) => g.steps.length > 0);
}

export const setupProgress = (steps: readonly SetupStep[]) => ({
  done: steps.filter((s) => s.state === 'configured').length,
  total: steps.length,
});

/** أول خطوة غير مهيّأة بترتيب العرض؛ `null` حين اكتمل كل شيء. */
export const nextStep = (steps: readonly SetupStep[]): SetupStep | null => steps.find((s) => s.state === 'not_configured') ?? null;

/**
 * FLOWERS-H2-12 — الخطوة الحالية في التهيئة الموجَّهة. الأولوية: ما طلبه الرابط (`?step=`) إن كان مفتاحاً معروفاً؛
 * وإلا أول خطوة غير مهيّأة؛ وإلا (اكتملت كلها) أول خطوة. **لا حالة مخزَّنة**: العودة لاحقاً تستأنف من الإعداد الفعلي.
 */
export function resolveCurrentIndex(steps: readonly SetupStep[], requestedKey: string | null): number {
  if (steps.length === 0) return -1;
  const requested = requestedKey === null ? -1 : steps.findIndex((s) => s.key === requestedKey);
  if (requested >= 0) return requested;
  const firstOpen = steps.findIndex((s) => s.state === 'not_configured');

  return firstOpen >= 0 ? firstOpen : 0;
}
