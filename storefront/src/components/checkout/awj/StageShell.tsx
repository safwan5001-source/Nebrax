"use client";

import type { ReactNode } from "react";

/**
 * The frame every checkout stage sits in: one titled card, an optional
 * supporting line, the stage's own fields, and the stage's actions pinned to
 * the bottom of the card. Six stages that each invented their own heading and
 * button placement would read as six screens; this makes them read as one flow.
 */
export function StageShell({
  id,
  title,
  description,
  children,
  actions,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="rounded-store border border-store-border bg-store-surface"
    >
      <header className="border-b border-store-border px-5 py-4">
        <h2
          id={`${id}-heading`}
          className="text-base font-bold text-store-foreground"
        >
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-sm leading-relaxed text-store-muted-foreground">
            {description}
          </p>
        )}
      </header>
      <div className="px-5 py-5">{children}</div>
      {actions && (
        <div className="flex flex-col-reverse gap-2 border-t border-store-border px-5 py-4 sm:flex-row sm:justify-end">
          {actions}
        </div>
      )}
    </section>
  );
}

/**
 * A labelled field row, so every stage's inputs line up identically.
 *
 * There is no required-field asterisk. Optional fields say so in their own
 * label ("البريد الإلكتروني (اختياري)"), which is both the clearer convention
 * on a short form and the one already in the message catalogue — and it keeps
 * the label's text equal to its field's accessible name rather than trailing a
 * decorative glyph into it.
 */
export function StageField({
  id,
  label,
  hint,
  span,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  span?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={span ? "sm:col-span-2" : undefined}>
      <label
        htmlFor={id}
        className="text-xs font-semibold text-store-foreground"
      >
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint && (
        <p className="mt-1 text-xs text-store-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
