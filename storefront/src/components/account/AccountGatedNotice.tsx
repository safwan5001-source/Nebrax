"use client";

import { Info } from "lucide-react";

/**
 * The honest caption on a DESIGN_ONLY account surface.
 *
 * It states that the intended UX is built and that the store cannot yet
 * do the thing. It never reports success, never names a provider, and
 * never invents a commercial fact.
 */
export function AccountGatedNotice({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-store border border-store-border bg-store-surface-muted p-4"
    >
      <Info
        className="mt-0.5 size-4 shrink-0 text-store-muted-foreground"
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className="text-sm font-bold text-store-foreground">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-store-muted-foreground">
          {body}
        </p>
      </div>
    </div>
  );
}
