/**
 * TANKER-PR2 — عقد قراءة واجهة إدارة أصحاب الصهاريج (PR-1). الحقول الحسّاسة (`phone`، `notes`، `note`، `end_reason`) **اختيارية**:
 * الخادم يحذفها من الاستجابة لمن لا يملك `fuel.tanker.manage`، فالواجهة تعاملها غياباً لا قيمة فارغة.
 * لا `tenant_id` ولا `partner_id` للملف ولا `plate_key` في أي استجابة (يحرسه الخادم).
 */
export type TankerStatus = 'active' | 'suspended' | 'inactive';
export const TANKER_STATUSES: readonly TankerStatus[] = ['active', 'suspended', 'inactive'];

export interface TankerOwner {
  id: string;
  code: string | null;
  name: string;
  status: TankerStatus;
  phone?: string | null;
  notes?: string | null;
  created_at: string | null;
}

export interface Tanker {
  id: string;
  fuel_tanker_owner_id: string;
  plate_number: string;
  plate_country: string | null;
  /** سعة بالمللتر عدد صحيح؛ تُعرض باللتر في طبقة العرض فقط. */
  capacity_milliliters: number | null;
  status: TankerStatus;
  notes?: string | null;
  owner?: { id: string; name: string; code: string | null };
  created_at: string | null;
}

export interface OwnerCompanyLink {
  id: string;
  fuel_tanker_owner_id: string;
  partner_id: string;
  partner?: { id: string; name: string } | null;
  valid_from: string;
  valid_to: string | null;
  /** مشتق في الخادم من التواريخ وقت القراءة. */
  is_active: boolean;
  note?: string | null;
  end_reason?: string | null;
  created_at: string | null;
}

export interface PageMeta {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
}

export interface Paged<T> {
  rows: T[];
  meta: PageMeta;
}

export interface CustomerOption {
  id: string;
  name: string;
  code: string | null;
}

export type LinkPhase = 'active' | 'ended' | 'upcoming';
