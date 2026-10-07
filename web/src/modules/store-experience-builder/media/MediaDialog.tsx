"use client";

/**
 * Modal shell for the media surfaces: a real focus trap and focus return to
 * the opener (V0 §7.10 — "focus returns to the opener"), Escape to close. Full
 * screen on phones (a sheet in practice), a centred dialog from `md` up.
 */
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

export function MediaDialog({
  open,
  onClose,
  title,
  description,
  closeLabel,
  children,
  footer,
  wide = false,
  locale,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  closeLabel: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** The builder's locale — the dialog is portalled out of the builder shell, so it carries its own direction. */
  locale: "ar" | "en";
}) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-text opacity-40" />
        <DialogPrimitive.Content
          data-media-dialog=""
          dir={locale === "ar" ? "rtl" : "ltr"}
          lang={locale}
          className={`fixed inset-0 z-[70] flex flex-col border-border bg-surface outline-none md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[calc(100dvh-4rem)] md:w-[calc(100vw-4rem)] md:-translate-x-1/2 md:-translate-y-1/2 md:border ${
            wide ? "md:max-w-4xl" : "md:max-w-2xl"
          }`}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
            <DialogPrimitive.Title className="min-w-0 truncate text-base font-semibold text-text">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="-m-1 flex size-11 shrink-0 items-center justify-center text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 md:size-9"
              aria-label={closeLabel}
            >
              <X aria-hidden="true" className="size-4" strokeWidth={1.7} />
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description
            className={description ? "px-4 pt-3 text-[12px] leading-5 text-muted" : "sr-only"}
          >
            {description ?? title}
          </DialogPrimitive.Description>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4">
            {children}
          </div>
          {footer ? (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
              {footer}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
