"use client";

import type { LucideIcon } from "lucide-react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { localeDirection } from "@/i18n/locales";

export function AccountEmptyState({
  icon: Icon,
  title,
  description,
  actionHref,
  actionLabel,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  const rtl = localeDirection(useLocale()) === "rtl";
  const Arrow = rtl ? ArrowLeft : ArrowRight;

  return (
    <div className="flex flex-col items-start py-2">
      <Icon
        className="size-5 text-store-muted-foreground"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <h2 className="mt-3 text-base font-semibold text-store-foreground">
        {title}
      </h2>
      <p className="mt-1 max-w-md text-sm leading-relaxed text-store-muted-foreground">
        {description}
      </p>
      {actionHref && actionLabel && (
        <Button asChild className="mt-4" size="sm">
          <Link href={actionHref}>
            {actionLabel}
            <Arrow className="size-3.5" aria-hidden="true" />
          </Link>
        </Button>
      )}
    </div>
  );
}
