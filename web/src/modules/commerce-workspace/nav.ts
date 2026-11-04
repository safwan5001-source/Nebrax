export type CommerceWorkspaceNavItem = {
  href: string;
  labelKey: string;
  appKey?: string;
  permission?: string;
};

export type CommerceWorkspaceNavGroup = {
  labelKey: string;
  items: CommerceWorkspaceNavItem[];
};

/**
 * Destinations that belong to Commerce Workspace only.
 * Core AWJ modules (products, customers, inventory, invoices, payments,
 * reports, RBAC) stay in AWJ and are not copied here.
 */
export const COMMERCE_WORKSPACE_NAV_GROUPS: CommerceWorkspaceNavGroup[] = [
  {
    labelKey: 'groupOverview',
    items: [
      { href: '/commerce', labelKey: 'overview' },
      // COMMERCE-ORDERS-O1b — يظهر لمن يملك الصلاحية وحين تكون قدرة المتجر مفعّلة (المسار يردّ 403 بدونهما).
      { href: '/commerce/orders', labelKey: 'orders', appKey: 'commerce.storefront', permission: 'commerce.orders.view' },
      // COPS-H3-5 — مساحة استقبال الطلبات الحية (نفس الصلاحية والقدرة؛ التنبيه الحي نفسه خلف بوابة H3-3 ويظهر حالة «غير مفعّل» عند إغلاقها).
      { href: '/commerce/orders/live', labelKey: 'ordersLive', appKey: 'commerce.storefront', permission: 'commerce.orders.view' },
    ],
  },
  {
    labelKey: 'groupStore',
    items: [
      { href: '/commerce/stores', labelKey: 'stores' },
      { href: '/commerce/published-products', labelKey: 'publishedProducts' },
      { href: '/commerce/merchandising', labelKey: 'merchandising', permission: 'products.view' },
      { href: '/commerce/themes', labelKey: 'themeGallery' },
      { href: '/commerce/appearance', labelKey: 'appearance' },
      { href: '/app-builder', labelKey: 'appBuilder', appKey: 'commerce.app_builder', permission: 'apps_builder.view' },
    ],
  },
  {
    labelKey: 'groupChannel',
    items: [
      // COPS-H4-1 — مركز تنقّل نحو أقسام الإعداد القائمة (بلا صلاحية خاصة: كل بطاقة تُصفّى بصلاحية قسمها).
      { href: '/commerce/settings', labelKey: 'settingsHub' },
      { href: '/commerce/domains', labelKey: 'domains' },
      { href: '/commerce/delivery', labelKey: 'delivery' },
      // حسابات عملاء التجزئة لقناة الويب — الخادم يشترط commerce.channel_settings.manage (مالك/مدير) وقدرة المتجر.
      { href: '/commerce/customer-accounts', labelKey: 'customerAccounts', appKey: 'commerce.storefront', permission: 'commerce.channel_settings.manage' },
      { href: '/commerce/gifting', labelKey: 'gifting', permission: 'commerce.manage' },
      { href: '/commerce/integrations', labelKey: 'integrations' },
    ],
  },
  {
    labelKey: 'groupWholesale',
    // Single entry: the Wholesale Merchant Workspace owns its own section bar (modules/commerce-workspace/wholesale),
    // so its eleven sections are not repeated in this navigation.
    items: [{ href: '/commerce/wholesale', labelKey: 'wholesale', permission: 'commerce.wholesale.manage' }],
  },
];

export const COMMERCE_WORKSPACE_HREFS = COMMERCE_WORKSPACE_NAV_GROUPS.flatMap((group) =>
  group.items.map((item) => item.href),
);

export function isCommerceWorkspacePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === '/commerce' || pathname.startsWith('/commerce/');
}

export function isCommerceNavItemActive(href: string, pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if (href === '/commerce') return pathname === '/commerce';
  if (!(pathname === href || pathname.startsWith(`${href}/`))) return false;
  // أطول بادئة تطابق تفوز: `/commerce/orders/live` لا تُضيء معها `/commerce/orders`.
  return !COMMERCE_WORKSPACE_HREFS.some((other) => other.length > href.length && other !== '/commerce' && (pathname === other || pathname.startsWith(`${other}/`)));
}
