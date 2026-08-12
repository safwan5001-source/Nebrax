import { api } from './api';

interface InventorySettings {
  show_stock_quantities: boolean;
}

/**
 * هل تُعرض كميات المخزون في شاشات المنتجات؟ (`inventory-settings`).
 *
 * مصدر واحد تستهلكه شاشات العرض، على نمط `getSystemTaxInclusive`. الاحتياطي
 * عند الفشل `true` — أي **السلوك القائم**: خللٌ في جلب تفضيل عرض يجب ألّا
 * يُخفي بياناتٍ يتوقّعها المستخدم.
 */
export async function getShowStockQuantities(): Promise<boolean> {
  try {
    const r = await api<{ data: InventorySettings }>('/inventory-settings');
    return r.data.show_stock_quantities !== false;
  } catch {
    return true;
  }
}
