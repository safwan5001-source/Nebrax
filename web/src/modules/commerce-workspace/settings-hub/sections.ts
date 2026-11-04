import { isNavEntryVisible, type NavViewer } from '@/components/layout/nav-visibility';
import { COMMERCE_WORKSPACE_NAV_GROUPS } from '../nav';
import type { CommerceWorkspaceMessageKey } from '../messages';

/**
 * COPS-H4-1 — مركز إعدادات المتجر: **تنقّل بحت** نحو أقسام قائمة. لا نموذج مكرر هنا، ولا قراءة لـAPI إعدادات،
 * ولا صلاحية جديدة. شروط ظهور كل بطاقة تُشتقّ من عنصر التنقل نفسه (`nav.ts` = المصدر الوحيد للصلاحية وقدرة التطبيق)
 * ثم تُضاف فوقها `requires` حين تشترط صفحة القسم صلاحية أصرم من عنصر التنقل — فلا بطاقة تقود إلى حالة «ممنوع».
 */
export type SettingsHubSection = {
  /** مسار القسم؛ يجب أن يطابق عنصراً في `COMMERCE_WORKSPACE_NAV_GROUPS`. */
  href: string;
  labelKey: CommerceWorkspaceMessageKey;
  descriptionKey: CommerceWorkspaceMessageKey;
  /** صلاحية تفرضها صفحة القسم نفسها وليست في عنصر التنقل (مثلاً `commerce.manage`). */
  requires?: string;
};

export const SETTINGS_HUB_SECTIONS: readonly SettingsHubSection[] = [
  { href: '/commerce/appearance', labelKey: 'appearance', descriptionKey: 'settingsHubDescAppearance' },
  { href: '/commerce/domains', labelKey: 'domains', descriptionKey: 'settingsHubDescDomains', requires: 'commerce.manage' },
  { href: '/commerce/delivery', labelKey: 'delivery', descriptionKey: 'settingsHubDescDelivery', requires: 'commerce.manage' },
  { href: '/commerce/shipping-zones', labelKey: 'shippingZones', descriptionKey: 'settingsHubDescShippingZones' },
  { href: '/commerce/customer-accounts', labelKey: 'customerAccounts', descriptionKey: 'settingsHubDescCustomerAccounts' },
  { href: '/commerce/gifting', labelKey: 'gifting', descriptionKey: 'settingsHubDescGifting' },
  { href: '/commerce/integrations', labelKey: 'integrations', descriptionKey: 'settingsHubDescIntegrations' },
];

const NAV_ITEMS = COMMERCE_WORKSPACE_NAV_GROUPS.flatMap((group) => group.items);

/** عنصر التنقل المقابل لمسار القسم (مصدر الصلاحية/القدرة). `undefined` ⇒ المسار ليس في التنقل فلا تُعرض بطاقته. */
export function navItemForSection(href: string) {
  return NAV_ITEMS.find((item) => item.href === href);
}

export function isSettingsSectionVisible(
  section: SettingsHubSection,
  hiddenAppKeys: Set<string>,
  viewer: NavViewer | null | undefined,
): boolean {
  const navItem = navItemForSection(section.href);
  if (!navItem) return false;
  if (!isNavEntryVisible(navItem, hiddenAppKeys, viewer)) return false;
  // الشرط الإضافي يمرّ بالمساعد المشترك نفسه (لا استيراد مباشر لـ`hasPermission`، انظر `capabilities.guard.test.ts`).
  if (section.requires && !isNavEntryVisible({ permission: section.requires }, hiddenAppKeys, viewer)) return false;

  return true;
}

export function visibleSettingsSections(
  hiddenAppKeys: Set<string>,
  viewer: NavViewer | null | undefined,
): SettingsHubSection[] {
  return SETTINGS_HUB_SECTIONS.filter((section) => isSettingsSectionVisible(section, hiddenAppKeys, viewer));
}
