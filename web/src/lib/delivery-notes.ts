export type DeliveryNoteStatus = 'draft' | 'confirmed' | 'cancelled';

export interface DeliveryNoteLine {
  id?: string;
  line_number?: number;
  product_id: string;
  product_name?: string;
  product_sku?: string | null;
  product_barcode?: string | null;
  unit_name: string;
  unit_factor?: number;
  quantity: number;
  quantity_numerator?: number | null;
  quantity_denominator?: number | null;
  description?: string | null;
}

export interface DeliveryNoteEvent {
  id: string;
  event: string;
  from_status: DeliveryNoteStatus | null;
  to_status: DeliveryNoteStatus | null;
  actor_id: string | null;
  actor_name: string | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  occurred_at: string;
}

export interface DeliveryNote {
  id: string;
  branch_id: string;
  number: string;
  status: DeliveryNoteStatus;
  version: number;
  external_reference: string | null;
  delivery_date: string;
  notes: string | null;
  customer_id: string;
  customer?: { id: string; name: string; type: string } | null;
  warehouse_id: string;
  warehouse?: { id: string; name: string; code: string | null } | null;
  created_by: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  lines: DeliveryNoteLine[];
  events?: DeliveryNoteEvent[];
  invoice_draft?: {
    allocation_id: string;
    invoice_id: string;
    number: string | null;
    status: string | null;
    line_count: number | null;
  } | null;
  created_at?: string;
  updated_at?: string;
}

export interface DeliveryLineInput {
  key: string;
  productId: string;
  unit: string;
  quantity: string;
  description: string;
}

export const DELIVERY_NOTE_PERMISSIONS = {
  view: 'delivery_notes.view',
  manage: 'delivery_notes.manage',
  confirm: 'delivery_notes.confirm',
  cancel: 'delivery_notes.cancel',
  invoice: 'delivery_notes.invoice',
} as const;

export function hasPermission(permissions: string[] | undefined, role: string | undefined, permission: string): boolean {
  return role === 'owner'
    || role === 'admin'
    || permissions?.includes('*') === true
    || permissions?.includes(permission) === true;
}

/**
 * متحقق واجهة متحفظ للكمية الصحيحة؛ حقيقة الدقة تبقى في الخادم.
 * لا يحول النص إلى float حتى لا يخفي إدخالاً غير صحيحاً.
 */
export function validWholeQuantity(value: string): boolean {
  return /^[1-9][0-9]{0,6}$/.test(value.trim()) && Number(value) <= 1000000;
}

export interface DeliveryNoteItemPayload {
  product_id: string;
  unit: string | null;
  quantity: number;
  description: string | null;
}

/** يبني سطور API من قيم النموذج فقط بعد تحقق صحيح ومحدود. */
export function toDeliveryNoteItems(lines: DeliveryLineInput[]): DeliveryNoteItemPayload[] {
  if (lines.length === 0) throw new Error('delivery_note_lines_required');

  return lines.map((line) => {
    if (!line.productId) throw new Error('delivery_note_product_required');
    if (!validWholeQuantity(line.quantity)) throw new Error('delivery_note_quantity_invalid');

    return {
      product_id: line.productId,
      unit: line.unit.trim() || null,
      quantity: Number(line.quantity),
      description: line.description.trim() || null,
    };
  });
}

export function statusTone(status: DeliveryNoteStatus): 'positive' | 'muted' | 'negative' {
  if (status === 'confirmed') return 'positive';
  if (status === 'cancelled') return 'negative';
  return 'muted';
}
