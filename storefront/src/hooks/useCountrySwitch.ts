"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { useCart } from "@/contexts/CartContext";
import type { CountryWithMarket } from "@/contexts/StoreContext";
import { rebaseAccountRedirectSearch } from "@/lib/utils/account-redirect";
import { setStoreCookies } from "@/lib/utils/cookies";
import { getPathWithoutPrefix } from "@/lib/utils/path";

interface UseCountrySwitchOptions {
  currentCountry: string;
  currentLocale: string;
  onBeforeNavigate?: () => void;
}

interface UseCountrySwitchResult {
  isCartLoading: boolean;
  isCountryNavigating: boolean;
  handleCountrySelect: (
    entry: CountryWithMarket,
    locale?: string,
  ) => Promise<boolean>;
}

export function useCountrySwitch({
  currentCountry,
  currentLocale,
  onBeforeNavigate,
}: UseCountrySwitchOptions): UseCountrySwitchResult {
  const { loading: isCartLoading } = useCart();
  const pathname = usePathname();
  const [isCountryNavigating, setIsCountryNavigating] = useState(false);

  const handleCountrySelect = async (
    entry: CountryWithMarket,
    locale?: string,
  ): Promise<boolean> => {
    const nextCountry = entry.iso.toLowerCase();
    const activeCountry = currentCountry.toLowerCase();
    const newLocale = locale || entry.default_locale || "en";

    if (isCountryNavigating) {
      return false;
    }

    if (nextCountry === activeCountry && newLocale === currentLocale) {
      return true;
    }

    if (isCartLoading) {
      return false;
    }

    setIsCountryNavigating(true);

    const pathRest = getPathWithoutPrefix(pathname);
    const newPath = `/${nextCountry}/${newLocale}${pathRest}`;
    const currentBasePath = `/${activeCountry}/${currentLocale}`;
    const nextBasePath = `/${nextCountry}/${newLocale}`;

    try {
      // The AWJ cart has no market/locale-per-cart concept, so switching
      // country only updates the store cookies and navigates.
      setStoreCookies(nextCountry, newLocale);
      onBeforeNavigate?.();
      const nextSearch = rebaseAccountRedirectSearch(
        window.location.search,
        currentBasePath,
        nextBasePath,
      );
      window.location.assign(`${newPath}${nextSearch}${window.location.hash}`);
      return true;
    } catch {
      return false;
    } finally {
      setIsCountryNavigating(false);
    }
  };

  return {
    isCartLoading,
    isCountryNavigating,
    handleCountrySelect,
  };
}
