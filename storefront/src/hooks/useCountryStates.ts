import { useEffect, useState, useTransition } from "react";
import type { StoreState } from "@/lib/commerce/types";

/**
 * Fetches states for a country ISO code, with cleanup on unmount/change.
 * Returns [states, loading].
 */
export function useCountryStates(
  countryIso: string,
  fetchStates: (countryIso: string) => Promise<StoreState[]>,
  enabled = true,
): [StoreState[], boolean] {
  const [states, setStates] = useState<StoreState[]>([]);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!enabled || !countryIso) {
      setStates([]);
      return;
    }

    let cancelled = false;

    startTransition(() => {
      fetchStates(countryIso)
        .then((result) => {
          if (!cancelled) setStates(result);
        })
        .catch(() => {
          if (!cancelled) setStates([]);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [countryIso, fetchStates, enabled]);

  return [states, isPending];
}
