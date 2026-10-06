import {
  Bell,
  Clock,
  Gift,
  Heart,
  Info,
  type LucideIcon,
  Megaphone,
  Percent,
  ShieldCheck,
  Sparkles,
  Star,
  Tag,
  Truck,
} from "lucide-react";
import type { AnnouncementIconKey } from "./presentation/announcements";

/** Same registry the storefront renders (V0 §11.4) — one key, one glyph. */
export const ANNOUNCEMENT_ICON_COMPONENTS: Record<
  AnnouncementIconKey,
  LucideIcon
> = {
  megaphone: Megaphone,
  bell: Bell,
  info: Info,
  tag: Tag,
  percent: Percent,
  truck: Truck,
  gift: Gift,
  clock: Clock,
  star: Star,
  heart: Heart,
  sparkles: Sparkles,
  "shield-check": ShieldCheck,
};
