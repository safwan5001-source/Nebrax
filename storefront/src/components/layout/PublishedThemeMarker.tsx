"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { ThemePresetId } from "@/lib/presentation/tokens";

/**
 * The bounded theme marker seam AWJ Market styling enters through (see the
 * AWJ Market Master Spec §D/§30). `ProductCard` and other shared client
 * components read this instead of forking into a `Market*` component —
 * unknown/absent presets read as `"awj-modern"`, so every existing theme
 * keeps its current look with zero code change.
 */
const PublishedThemeMarkerContext = createContext<ThemePresetId>("awj-modern");

export function PublishedThemeMarkerProvider({
  themePreset,
  children,
}: {
  themePreset: ThemePresetId;
  children: ReactNode;
}) {
  return (
    <PublishedThemeMarkerContext.Provider value={themePreset}>
      {children}
    </PublishedThemeMarkerContext.Provider>
  );
}

export function usePublishedThemeMarker(): ThemePresetId {
  return useContext(PublishedThemeMarkerContext);
}
