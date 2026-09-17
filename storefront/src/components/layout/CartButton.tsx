"use client";

import { ShoppingBag } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useCart } from "@/contexts/CartContext";

export function CartButton() {
  const t = useTranslations("header");
  const { itemCount, openCart } = useCart();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <Button
      variant="ghost"
      size="icon-lg"
      onClick={openCart}
      aria-label={t("openCart")}
      className="relative"
    >
      <ShoppingBag className="size-5" />
      {mounted && itemCount > 0 && (
        <span className="absolute top-0 end-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-store-primary px-1 text-xs font-medium text-store-primary-foreground tabular-nums">
          {itemCount}
        </span>
      )}
    </Button>
  );
}
