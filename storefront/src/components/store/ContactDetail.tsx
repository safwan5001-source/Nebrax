import { Clock, type LucideIcon, Mail, MapPin, Phone } from "lucide-react";

export type ContactDetailKind = "phone" | "email" | "address" | "hours";

const CONTACT_ICONS: Record<ContactDetailKind, LucideIcon> = {
  phone: Phone,
  email: Mail,
  address: MapPin,
  hours: Clock,
};

/** Edge-only trim. Internal spaces stay so a real value is not rewritten. */
export function contactDetailText(
  value: string | null | undefined,
): string | null {
  const text = value?.trim() ?? "";
  return text ? text : null;
}

/**
 * Utility icon plus the merchant's own text. The icon is decorative.
 * Empty values render nothing. This is not a link.
 */
export function ContactDetail({
  kind,
  value,
}: {
  kind: ContactDetailKind;
  value: string | null | undefined;
}) {
  const text = contactDetailText(value);
  if (!text) return null;
  const Icon = CONTACT_ICONS[kind];
  return (
    <p className="flex items-start gap-2">
      <Icon
        aria-hidden="true"
        data-contact-icon={kind}
        className="mt-0.5 size-4 shrink-0"
        strokeWidth={1.75}
      />
      <span className="min-w-0 break-words">{text}</span>
    </p>
  );
}
