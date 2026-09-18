"use client";

/**
 * A quiet, contextual caption on a DESIGN_ONLY account surface.
 *
 * Backend absence is stated once, as a line of supporting copy — not a
 * banner. The longer explanation stays available to assistive tech.
 * It never reports success, never names a provider, and never invents a
 * commercial fact.
 */
export function AccountGatedNotice({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <p
      role="status"
      className="text-sm leading-relaxed text-store-muted-foreground"
    >
      {title}
      {body ? <span className="sr-only"> {body}</span> : null}
    </p>
  );
}
