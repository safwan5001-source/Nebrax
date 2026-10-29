"use client";

import { useTranslations } from "next-intl";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import type { StoreAvailabilityFilter } from "@/lib/commerce/types";
import { getAvailabilityLabel } from "@/lib/utils/filters";
import { type AvailabilityStatus, isAvailabilityStatus } from "@/types/filters";

interface AvailabilityDropdownContentProps {
  filter: StoreAvailabilityFilter;
  selected?: AvailabilityStatus;
  onChange: (value?: AvailabilityStatus) => void;
}

export function AvailabilityDropdownContent({
  filter,
  selected,
  onChange,
}: AvailabilityDropdownContentProps) {
  const t = useTranslations("products");

  return (
    <DropdownMenuRadioGroup
      value={selected ?? ""}
      onValueChange={(value) => {
        if (!value || !isAvailabilityStatus(value)) {
          onChange(undefined);
        } else {
          onChange(value);
        }
      }}
    >
      <DropdownMenuRadioItem value="">
        {t("anyAvailability")}
      </DropdownMenuRadioItem>
      {filter.options.map((option) => (
        <DropdownMenuRadioItem
          key={option.id}
          value={option.id}
          onSelect={(e) => e.preventDefault()}
        >
          <span className="flex-1">{getAvailabilityLabel(option.id, t)}</span>
          <span className="text-xs text-muted-foreground">
            ({option.count})
          </span>
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}
