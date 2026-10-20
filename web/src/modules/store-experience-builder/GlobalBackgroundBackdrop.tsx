import type { CSSProperties } from "react";
import { useMediaRefPreview } from "./media/use-media-ref-preview";
import type { StorefrontPresentationConfig } from "./presentation/config";
import { resolveRoleHex } from "./presentation/palette";
import type { StorefrontBackground } from "./presentation/storefront-background";

/** Draft preview uses signed still previews only; it never asks the animation-preview store for media. */
export function GlobalBackgroundBackdrop({
	background,
	presentation,
	viewport,
}: {
	background: StorefrontBackground | undefined;
	presentation: StorefrontPresentationConfig;
	viewport: "desktop" | "tablet" | "mobile";
}) {
	const desktopUrl = useMediaRefPreview(
		background?.kind === "media" ? background.media : null,
	);
	const mobileUrl = useMediaRefPreview(
		background?.kind === "media" ? (background.mobile ?? null) : null,
	);
	if (background?.kind !== "media") return null;
	const useMobile =
		viewport === "mobile" && Boolean(mobileUrl && background.mobile);
	const src = useMobile ? mobileUrl : desktopUrl;
	if (!src) return null;
	const focal = useMobile ? background.mobile?.focal : background.media.focal;
	const overlay = background.overlay
		? {
				color:
					"hex" in background.overlay.color
						? background.overlay.color.hex
						: resolveRoleHex(background.overlay.color.role, presentation),
				opacity: background.overlay.alpha / 100,
			}
		: null;
	const imageStyle: CSSProperties = {
		position: "absolute",
		inset: 0,
		width: "100%",
		height: "100%",
		objectFit: "cover",
		objectPosition: focal ? `${focal.x}% ${focal.y}%` : "50% 50%",
	};

	return (
		<div
			aria-hidden="true"
			data-global-background-layer=""
			style={{
				position: "absolute",
				inset: 0,
				zIndex: -1,
				overflow: "hidden",
				pointerEvents: "none",
			}}
		>
			{/* biome-ignore lint/performance/noImgElement: signed editor-only still preview URL */}
			<img
				data-global-background-image=""
				src={src}
				alt=""
				loading="lazy"
				decoding="async"
				style={imageStyle}
			/>
			{overlay ? (
				<div
					data-global-background-overlay=""
					style={{
						position: "absolute",
						inset: 0,
						backgroundColor: overlay.color,
						opacity: overlay.opacity,
					}}
				/>
			) : null}
		</div>
	);
}
