import { Receipt, ScrollText, type LucideIcon } from "lucide-react";

export type IdentityDetailKind = "cr" | "vat";

const IDENTITY_ICONS: Record<IdentityDetailKind, LucideIcon> = {
  cr: ScrollText,
  vat: Receipt,
};

/** Edge-only trim. Internal spaces stay so a real value is not rewritten. */
export function identityDetailText(
  value: string | null | undefined,
): string | null {
  const text = value?.trim() ?? "";
  return text ? text : null;
}

/**
 * Preview twin of the published identity row.
 * AWJ utility icon beside the canonical label and value, never a link
 * and never an official CR or VAT mark. A blank value renders nothing.
 */
export function IdentityDetail({
  kind,
  label,
  value,
}: {
  kind: IdentityDetailKind;
  label: string;
  value: string | null | undefined;
}) {
  const text = identityDetailText(value);
  if (!text) return null;
  const Icon = IDENTITY_ICONS[kind];
  return (
    <p className="flex items-start gap-2" data-identity-detail={kind}>
      <Icon
        aria-hidden="true"
        data-identity-icon={kind}
        className="mt-0.5 size-4 shrink-0"
        strokeWidth={1.75}
      />
      <span className="min-w-0 break-words">
        {label}: {text}
      </span>
    </p>
  );
}
