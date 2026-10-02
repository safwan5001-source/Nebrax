/**
 * Lifecycle registry (design-system/v3/LIFECYCLE_MODEL.md §2/§5).
 *
 * A definition MIRRORS the stored `status` values of a document — it never invents a
 * state. `LifecycleDefinition.document.sequence` is the linear stored path, `terminal`
 * the stored end states that replace the path when reached. `payment` is an independent
 * axis (`payment_status`), meaningful only once the document is posted.
 *
 * Every definition is guarded by lifecycle.test.ts, which compares its values with the
 * backend validation lists (`in:draft,posted,cancelled`). Add a state here only after it
 * exists in the backend.
 */
export interface LifecycleDefinition {
  domain: string;
  document: { sequence: readonly string[]; terminal: readonly string[] };
  payment?: readonly string[];
}

export const SALES_INVOICE_LIFECYCLE: LifecycleDefinition = {
  domain: 'sales-invoice',
  document: { sequence: ['draft', 'posted'], terminal: ['cancelled'] },
  payment: ['unpaid', 'partial', 'paid'],
};

export const PURCHASE_LIFECYCLE: LifecycleDefinition = {
  domain: 'purchase',
  document: { sequence: ['draft', 'posted'], terminal: ['cancelled'] },
  payment: ['unpaid', 'partial', 'paid'],
};
