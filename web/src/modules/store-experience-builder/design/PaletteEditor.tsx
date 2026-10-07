"use client";

import type { CustomizerMessageKey } from "../messages";
import {
  PALETTE_ROLES,
  type PaletteRoleKey,
  type PresentationPalette,
  normalizePalette,
  resolveRoleHex,
} from "../presentation/palette";
import type { DesignContext } from "../presentation/section-design-resolve";
import { ColourField } from "./ColourField";

const LABEL: Record<PaletteRoleKey, CustomizerMessageKey> = {
  surface: "designRoleSurface",
  surfaceAlt: "designRoleSurfaceAlt",
  text: "designRoleText",
  heading: "designRoleHeading",
  link: "designRoleLink",
  border: "designRoleBorder",
  overlay: "designRoleOverlay",
};

/**
 * CUST-HV V5d — define the palette roles once; sections then reference them.
 * A role left unset keeps today's fixed token (V0 §4.1), shown as the "automatic"
 * value so the merchant sees what is in use.
 */
export function PaletteEditor({
  palette,
  ctx,
  t,
  onChange,
}: {
  palette: PresentationPalette | undefined;
  ctx: DesignContext;
  t: (key: CustomizerMessageKey) => string;
  onChange: (next: PresentationPalette | undefined) => void;
}) {
  return (
    <div data-palette-editor="" className="space-y-4">
      {PALETTE_ROLES.map((role) => (
        <ColourField
          key={role}
          dataName={`palette-${role}`}
          label={t(LABEL[role])}
          hexOnly
          value={palette?.[role] ? { hex: palette[role] as string } : undefined}
          ctx={ctx}
          t={t}
          automatic={{ hex: resolveRoleHex(role, { ...ctx, palette: undefined }), label: t("designColourNone") }}
          onChange={(next) =>
            onChange(
              normalizePalette({
                ...palette,
                [role]: next && "hex" in next ? next.hex : undefined,
              }),
            )
          }
        />
      ))}
    </div>
  );
}
