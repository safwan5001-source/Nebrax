"use client";

import { CouponCode } from "@/components/checkout/CouponCode";
import { Summary } from "@/components/checkout/Summary";
import type { StoreCart } from "@/lib/commerce/types";

interface CheckoutSidebarProps {
  cart: StoreCart;
  onApplyCode: (code: string) => Promise<{ success: boolean; error?: string }>;
  onRemoveDiscount: (
    code: string,
  ) => Promise<{ success: boolean; error?: string }>;
  onRemoveGiftCard: (
    giftCardId: string,
  ) => Promise<{ success: boolean; error?: string }>;
}

export function CheckoutSidebar({
  cart,
  onApplyCode,
  onRemoveDiscount,
  onRemoveGiftCard,
}: CheckoutSidebarProps) {
  return (
    <>
      <Summary cart={cart} />
      <div className="mt-6 pt-6 border-t border-gray-200">
        <CouponCode
          cart={cart}
          onApply={onApplyCode}
          onRemoveDiscount={onRemoveDiscount}
          onRemoveGiftCard={onRemoveGiftCard}
        />
      </div>
    </>
  );
}
