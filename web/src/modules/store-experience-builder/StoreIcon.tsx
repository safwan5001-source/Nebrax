import {
  BadgeCheck,
  Calendar,
  Clock,
  CreditCard,
  Gift,
  Globe,
  Headphones,
  Heart,
  Leaf,
  Lock,
  Mail,
  MapPin,
  MessageCircle,
  Package,
  Percent,
  Phone,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
  Tag,
  Truck,
  Users,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { ICON_REGISTRY, type IconKey, normalizeIconKey } from './presentation/icon-registry';

/** The glyph of every registry key — twin of the storefront's `StoreIcon` map (the registry test pins both to the key list). */
export const ICON_GLYPHS: Readonly<Record<IconKey, ComponentType<SVGProps<SVGSVGElement>>>> = {
  truck: Truck,
  'shield-check': ShieldCheck,
  'credit-card': CreditCard,
  gift: Gift,
  clock: Clock,
  phone: Phone,
  'message-circle': MessageCircle,
  mail: Mail,
  'map-pin': MapPin,
  store: Store,
  star: Star,
  heart: Heart,
  tag: Tag,
  percent: Percent,
  package: Package,
  'refresh-ccw': RefreshCcw,
  headphones: Headphones,
  leaf: Leaf,
  sparkles: Sparkles,
  'badge-check': BadgeCheck,
  calendar: Calendar,
  users: Users,
  lock: Lock,
  globe: Globe,
};

/**
 * CUST-HV V7d-1 — Canvas / editor twin of the storefront's `StoreIcon`: decorative by default, an image when it is the only
 * content (`label`), nothing for an unknown key, mirrored under RTL when directional.
 */
export function StoreIcon({ name, label, className }: { name: unknown; label?: string; className?: string }) {
  const key = normalizeIconKey(name);
  if (!key) return null;
  const Glyph = ICON_GLYPHS[key];
  return (
    <Glyph
      className={['size-4 shrink-0', ICON_REGISTRY[key].directional ? 'rtl:-scale-x-100' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    />
  );
}
