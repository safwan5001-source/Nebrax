import { describe, expect, it } from 'vitest';
import {
  DELIVERY_NOTE_PERMISSIONS,
  hasPermission,
  statusTone,
  toDeliveryNoteItems,
  validWholeQuantity,
} from '@/lib/delivery-notes';

describe('delivery-note form contract', () => {
  it('accepts only bounded positive whole quantities', () => {
    expect(validWholeQuantity('1')).toBe(true);
    expect(validWholeQuantity('1000000')).toBe(true);
    expect(validWholeQuantity('0')).toBe(false);
    expect(validWholeQuantity('-1')).toBe(false);
    expect(validWholeQuantity('1.5')).toBe(false);
    expect(validWholeQuantity('1000001')).toBe(false);
    expect(validWholeQuantity('١')).toBe(false);
  });

  it('serializes a valid line with its entered unit and no pricing fields', () => {
    expect(toDeliveryNoteItems([{ key: 'line-1', productId: 'product-1', unit: 'box', quantity: '12', description: '  تسليم تجريبي  ' }]))
      .toEqual([{ product_id: 'product-1', unit: 'box', quantity: 12, description: 'تسليم تجريبي' }]);
  });

  it('rejects incomplete product lines and invalid quantities before API submission', () => {
    expect(() => toDeliveryNoteItems([])).toThrow('delivery_note_lines_required');
    expect(() => toDeliveryNoteItems([{ key: 'line-1', productId: '', unit: '', quantity: '1', description: '' }]))
      .toThrow('delivery_note_product_required');
    expect(() => toDeliveryNoteItems([{ key: 'line-1', productId: 'product-1', unit: '', quantity: '1.2', description: '' }]))
      .toThrow('delivery_note_quantity_invalid');
  });

  it('keeps sensitive actions separate by permission and recognizes privileged roles', () => {
    expect(hasPermission([DELIVERY_NOTE_PERMISSIONS.view], 'staff', DELIVERY_NOTE_PERMISSIONS.view)).toBe(true);
    expect(hasPermission([DELIVERY_NOTE_PERMISSIONS.view], 'staff', DELIVERY_NOTE_PERMISSIONS.confirm)).toBe(false);
    expect(hasPermission([], 'owner', DELIVERY_NOTE_PERMISSIONS.cancel)).toBe(true);
    expect(hasPermission(['*'], 'custom', DELIVERY_NOTE_PERMISSIONS.manage)).toBe(true);
  });

  it('maps each operational status to a semantic badge tone', () => {
    expect(statusTone('draft')).toBe('muted');
    expect(statusTone('confirmed')).toBe('positive');
    expect(statusTone('cancelled')).toBe('negative');
  });
});
