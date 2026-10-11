import { StoreIcon } from "@/components/ui/store-icon";
import type { IconKey } from "@/lib/presentation/icon-registry";
import type { NavBadge } from "@/lib/presentation/navigation";
import { cn } from "@/lib/utils";

/**
 * CUST-HV V7d-3 — the inside of one published navigation item: optional curated icon, the
 * label, optional badge. Shared by the desktop header and the mobile menu so both draw it
 * identically. A badge is a closed `brand | accent` pair (both foreground-proven in the theme).
 */
export function NavItemContent({
  label,
  icon,
  badge,
}: {
  label: string;
  icon?: IconKey;
  badge?: NavBadge;
}) {
  return (
    <>
      {icon ? <StoreIcon name={icon} className="size-4" /> : null}
      <span>{label}</span>
      {badge ? (
        <span
          data-nav-badge={badge.tone ?? "brand"}
          className={cn(
            "rounded-full px-1.5 py-px text-[0.625rem] font-bold leading-4",
            badge.tone === "accent"
              ? "bg-store-accent text-store-accent-foreground"
              : "bg-store-primary text-store-primary-foreground",
          )}
        >
          {badge.text}
        </span>
      ) : null}
    </>
  );
}
