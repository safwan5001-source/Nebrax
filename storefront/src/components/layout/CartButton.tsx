"use client";

import { ShoppingBag } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useCart } from "@/contexts/CartContext";
import { cn } from "@/lib/utils";

interface CartButtonProps {
  /**
   * `action` is the desktop treatment: the cart is the header's one committed
   * commerce action, so it is the only element there carrying a border and a
   * tint. `icon` is the compact handheld treatment.
   */
  variant?: "icon" | "action";
  className?: string;
}

export function CartButton({ variant = "icon", className }: CartButtonProps) {
  const t = useTranslations("header");
  const { itemCount, openCart } = useCart();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const badge = mounted && itemCount > 0 && (
    <span className="absolute -top-1 -end-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-store-primary px-1 text-[0.625rem] font-bold text-store-primary-foreground tabular-nums">
      {itemCount}
    </span>
  );

  if (variant === "action") {
    return (
      <button
        type="button"
        onClick={openCart}
        // The label is hidden below lg, so the name cannot come from the text.
        aria-label={t("openCart")}
        className={cn(
          "inline-flex h-10 items-center gap-2 rounded-store border border-store-primary/15 bg-store-primary-soft px-3.5 text-sm font-semibold text-store-primary transition-colors hover:bg-store-primary/10",
          className,
        )}
      >
        <span className="relative">
          <ShoppingBag className="size-5" aria-hidden="true" />
          {badge}
        </span>
        <span className="hidden lg:inline">{t("cart")}</span>
      </button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon-lg"
      onClick={openCart}
      aria-label={t("openCart")}
      className={cn("relative", className)}
    >
      <ShoppingBag className="size-5" />
      {badge}
    </Button>
  );
}
