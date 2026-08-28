import { describe, expect, it } from 'vitest';
import { isPosDialogOpen, isPosSaleInteractionBlocked, isPosShortcutBlocked } from './pos-interaction-context';

const closedFlags = {
  pickerOpen: false,
  retrieveOpen: false,
  returnOpen: false,
  exchangeOpen: false,
  recentInvoicesOpen: false,
  openCartsOpen: false,
  clearCartOpen: false,
  noteOpen: false,
  sensitiveActionOpen: false,
  closeOpen: false,
  unsavedExitOpen: false,
  sessionGateOpen: false,
};

describe('سياق تفاعل نقطة البيع', () => {
  it('يكشف أي حوار مفتوح', () => {
    expect(isPosDialogOpen(closedFlags)).toBe(false);
    expect(isPosDialogOpen({ ...closedFlags, pickerOpen: true })).toBe(true);
    expect(isPosDialogOpen({ ...closedFlags, sessionGateOpen: true })).toBe(true);
  });

  it('يحجب تفاعلات البيع أثناء الدفع أو الحوار', () => {
    expect(isPosSaleInteractionBlocked({ step: 'sale', dialogOpen: false })).toBe(false);
    expect(isPosSaleInteractionBlocked({ step: 'payment', dialogOpen: false })).toBe(true);
    expect(isPosSaleInteractionBlocked({ step: 'sale', dialogOpen: true })).toBe(true);
  });

  it('يترك Esc للحوار ويسمح بالرجوع من الدفع', () => {
    expect(isPosShortcutBlocked('back', { blockedInPayment: false }, { step: 'payment', dialogOpen: false })).toBe(false);
    expect(isPosShortcutBlocked('back', { blockedInPayment: false }, { step: 'sale', dialogOpen: true })).toBe(true);
    expect(isPosShortcutBlocked('payment', {}, { step: 'payment', dialogOpen: false })).toBe(true);
  });
});
