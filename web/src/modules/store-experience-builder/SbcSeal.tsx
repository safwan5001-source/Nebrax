"use client";

interface SbcSealProps {
  message: string;
}

/**
 * The authenticated customizer must not execute the government seal script
 * in the AWJ administration origin. The official seal is rendered only by
 * the published Storefront; this is an editor-only informational state.
 */
export function SbcSeal({ message }: SbcSealProps) {
  return (
    <div
      className="rounded-md border border-store-footer-border bg-store-surface px-3 py-2 text-sm text-store-footer-muted"
      data-testid="sbc-seal-preview"
      role="status"
    >
      {message}
    </div>
  );
}
