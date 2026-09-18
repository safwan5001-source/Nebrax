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
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span
        aria-hidden="true"
        className="flex size-16 items-center justify-center rounded-full bg-store-surface-muted text-store-muted-foreground"
      >
        <Icon className="size-7" strokeWidth={1.5} />
      </span>
      <h2 className="mt-5 text-lg font-bold text-store-foreground">{title}</h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-store-muted-foreground">
        {description}
      </p>
      {actionHref && actionLabel && (
        <Button asChild className="mt-6" size="lg">
          <Link href={actionHref}>
            {actionLabel}
            <Arrow className="size-4" aria-hidden="true" />
          </Link>
        </Button>
      )}
    </div>
  );
}
