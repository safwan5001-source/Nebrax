import {
  Banknote, BadgeDollarSign, Building2, Coins, CreditCard, HandCoins, Landmark, PiggyBank, QrCode, Receipt,
  ScrollText, Send, Smartphone, Wallet, type LucideIcon,
} from 'lucide-react';

/**
 * التخصيص البصري لطريقة الدفع. القائمة البيضاء مرآة لـ`App\Support\PaymentMethodVisual::ICON_KEYS` في الخادم (يحرس تطابقهما
 * اختبار `visual.test.ts`). لا استيراد ديناميكي للأيقونات: المفتاح يُحلّ من هذه الخريطة المغلقة أو يسقط إلى الافتراضي.
 */
export type VisualMode = 'default' | 'icon' | 'image';

export const ICON_REGISTRY = {
  banknote: Banknote,
  coins: Coins,
  wallet: Wallet,
  'credit-card': CreditCard,
  landmark: Landmark,
  receipt: Receipt,
  smartphone: Smartphone,
  'qr-code': QrCode,
  'hand-coins': HandCoins,
  'piggy-bank': PiggyBank,
  'badge-dollar-sign': BadgeDollarSign,
  'building-2': Building2,
  send: Send,
  'scroll-text': ScrollText,
} as const satisfies Record<string, LucideIcon>;

export type IconKey = keyof typeof ICON_REGISTRY;
export const ICON_KEYS = Object.keys(ICON_REGISTRY) as IconKey[];

/** حقول التخصيص كما يعيدها `GET /payment-methods`؛ غيابها (خادم/عميل قديم) = افتراضي. */
export interface PaymentMethodVisualFields {
  id?: string;
  settlement_type?: 'cash' | 'bank';
  visual_mode?: VisualMode | null;
  icon_key?: string | null;
  icon_color?: string | null;
  has_logo?: boolean;
  updated_at?: string | null;
}

const HEX = /^#[0-9A-Fa-f]{6}$/;
export const LOGO_MAX_BYTES = 1024 * 1024;
export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp';
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export function isHexColor(value: unknown): value is string { return typeof value === 'string' && HEX.test(value); }
export function isIconKey(value: unknown): value is IconKey { return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ICON_REGISTRY, value); }

/** الأيقونة الافتراضية التاريخية (مطابقة للعرض القديم): نقد ⇒ Banknote، غيره ⇒ Landmark. */
export function defaultIconFor(settlementType: 'cash' | 'bank' | undefined): LucideIcon {
  return settlementType === 'cash' ? Banknote : Landmark;
}

/** القرار النهائي للعرض بعد التحقق: أي قيمة غير صالحة تسقط إلى الافتراضي بصمت. */
export function resolveVisual(method: PaymentMethodVisualFields): { kind: 'default' } | { kind: 'icon'; icon: LucideIcon; color: string | null } | { kind: 'image' } {
  if (method.visual_mode === 'image' && method.has_logo && method.id) return { kind: 'image' };
  if (method.visual_mode === 'icon' && isIconKey(method.icon_key)) {
    return { kind: 'icon', icon: ICON_REGISTRY[method.icon_key], color: isHexColor(method.icon_color) ? method.icon_color : null };
  }
  return { kind: 'default' };
}

export function logoPath(method: Pick<PaymentMethodVisualFields, 'id' | 'updated_at'>): string {
  return `/payment-methods/${method.id}/logo${method.updated_at ? `?v=${encodeURIComponent(method.updated_at)}` : ''}`;
}
