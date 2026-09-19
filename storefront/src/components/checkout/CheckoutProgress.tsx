"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The checkout's progress indicator.
 *
 * It reports where the shopper is; it is not a navigation control. A step is
 * only reachable by going back through the flow itself, because each stage
 * writes to its own endpoint and skipping ahead would leave the server holding
 * a partial checkout the review stage would then have to un-tell.
 *
 * Completed steps carry a check, the current step is named and emphasised, and
 * upcoming steps are numbered and muted. On a phone the labels collapse to the
 * current step's name with a "step N of M" counter, because six labels do not
 * fit at 390px and truncating all six tells the shopper nothing.
 */

export interface CheckoutStepDescriptor {
  key: string;
  label: string;
}

export function CheckoutProgress({
  steps,
  currentIndex,
  counterLabel,
}: {
  steps: CheckoutStepDescriptor[];
  currentIndex: number;
  /** Already-interpolated "Step 2 of 6" — the phone-width summary. */
  counterLabel: string;
}) {
  const current = steps[currentIndex];

  return (
    <nav aria-label={counterLabel} className="w-full">
      {/* Phone: one label plus a counter. */}
      <div className="sm:hidden">
        <p className="text-xs font-medium text-store-muted-foreground">
          {counterLabel}
        </p>
        <p className="mt-0.5 text-base font-bold text-store-foreground">
          {current?.label}
        </p>
        <div
          className="mt-3 h-1 w-full overflow-hidden rounded-full bg-store-surface-muted"
          role="presentation"
        >
          <div
            className="h-full rounded-full bg-store-primary transition-[width] duration-300 motion-reduce:transition-none"
            style={{
              width: `${((currentIndex + 1) / steps.length) * 100}%`,
            }}
          />
        </div>
      </div>

      {/* Tablet and up: the full ladder. */}
      <ol className="hidden items-center gap-2 sm:flex">
        {steps.map((step, index) => {
          const done = index < currentIndex;
          const active = index === currentIndex;
          return (
            <li
              key={step.key}
              className="flex min-w-0 flex-1 items-center gap-2"
              aria-current={active ? "step" : undefined}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-bold tabular-nums",
                  done && "bg-store-primary text-store-primary-foreground",
                  active &&
                    "bg-store-primary text-store-primary-foreground ring-4 ring-store-primary-soft",
                  !done &&
                    !active &&
                    "border border-store-border-strong bg-store-surface text-store-muted-foreground",
                )}
              >
                {done ? (
                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  index + 1
                )}
              </span>
              <span
                className={cn(
                  "truncate text-xs",
                  active
                    ? "font-bold text-store-foreground"
                    : "font-medium text-store-muted-foreground",
                )}
              >
                {step.label}
              </span>
              {index < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-px min-w-3 flex-1",
                    done ? "bg-store-primary" : "bg-store-border",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
