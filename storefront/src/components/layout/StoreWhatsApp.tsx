import { MessageCircle } from "lucide-react";

interface StoreWhatsAppProps {
  href: string;
  label: string;
}

/**
 * Public WhatsApp control. Mounted only when Published presentation enables
 * it with a sanitary number. Does not send a message — it is a `wa.me` link.
 */
export function StoreWhatsApp({ href, label }: StoreWhatsAppProps) {
  return (
    <a
      href={href}
      aria-label={label}
      data-store-whatsapp=""
      rel="noopener noreferrer"
      className="fixed z-30 inline-flex size-12 items-center justify-center rounded-full bg-[#128c7e] text-white end-4 bottom-[calc(var(--store-bottom-nav-height)+1rem)] md:bottom-4"
    >
      <MessageCircle className="size-5" aria-hidden />
    </a>
  );
}
