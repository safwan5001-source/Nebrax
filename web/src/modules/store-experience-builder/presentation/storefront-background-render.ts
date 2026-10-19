import type { StorefrontPresentationConfig } from "./config";
import { cssGradientDirection } from "./section-design-resolve";
import type { ColorRef } from "./section-design";
import { resolveRoleHex } from "./palette";

/** CSS paint for the document-level background. Values are derived only from normalized enums/colours. */
export function resolveStorefrontBackgroundStyle(
  config: Pick<StorefrontPresentationConfig, "background" | "backgroundColor" | "primaryColor" | "accentColor" | "palette">,
  dir: "ltr" | "rtl",
): Record<string, string> {
  const fallback = config.backgroundColor ?? "#f8f9fa";
  const background = config.background;
  if (!background) return { backgroundColor: fallback };
  const context = { primaryColor: config.primaryColor, accentColor: config.accentColor, palette: config.palette };
  const colour = (ref: ColorRef) =>
    "hex" in ref ? ref.hex : resolveRoleHex(ref.role, context);
  if (background.kind === "solid") return { backgroundColor: colour(background.color) };
  if (background.kind === "gradient") {
    return { backgroundColor: fallback, backgroundImage: `linear-gradient(${cssGradientDirection(background.direction, dir)}, ${colour(background.from)}, ${colour(background.to)})` };
  }
  // Media remains draft-only until P3-A-06. Never turn a document value into a URL or CSS.
  return { backgroundColor: fallback };
}
