/** مخزن كما يعيده الـ API. يحمل الكميات؛ التقييم عالمي على المنتج. */
export interface Warehouse {
  id: string;
  code: string;
  name: string;
  branch_id: string | null;
  city?: string | null;
  address?: string | null;
  notes?: string | null;
  is_default: boolean;
  is_active: boolean;
}

/** رصيد كمية منتج داخل مخزن. */
export interface WarehouseStockRow {
  product_id: string;
  name: string;
  sku: string | null;
  quantity: number;
}
