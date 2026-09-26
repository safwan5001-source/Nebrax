import { OfficialSocialMark } from "@/components/brand/OfficialSocialMark";

interface StoreWhatsAppProps {
  href: string;
  label: string;
}

/**
 * Public WhatsApp control. Mounted only when Published presentation enables
 * it with a sanitary number. Does not send a message — it is a `wa.me` link.
 * The visual is the official WhatsApp glyph; destination semantics are unchanged.
 */
export function StoreWhatsApp({ href, label }: StoreWhatsAppProps) {
  return (
    <a
      href={href}
      aria-label={label}
      data-store-whatsapp=""
      target="_blank"
      rel="noopener noreferrer"
      className="fixed z-30 inline-flex size-12 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#111827] end-4 bottom-[calc(var(--store-bottom-nav-height)+1rem)] md:bottom-4"
    >
      <OfficialSocialMark network="whatsapp" size="floating" />
    </a>
  );
}
