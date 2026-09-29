"use client";

interface SbcSealProps {
  message: string;
}

/**
 * Storefront customizer and dev preview must not execute the government
 * seal script or place the seal token in a third-party loader. The official
 * seal is rendered only by the published public Storefront. This is an
 * editor-only informational state.
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
