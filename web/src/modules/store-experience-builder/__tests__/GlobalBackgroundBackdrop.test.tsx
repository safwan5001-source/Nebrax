// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalBackgroundBackdrop } from "../GlobalBackgroundBackdrop";
import { DEFAULT_PRESENTATION_CONFIG } from "../presentation/config";
import type { StorefrontBackground } from "../presentation/storefront-background";

vi.mock("../media/use-media-ref-preview", () => ({
	useMediaRefPreview: (ref: { mediaId: string } | null) => {
		if (!ref) return null;
		return ref.mediaId.endsWith("1")
			? null
			: `/signed-preview/${ref.mediaId}.jpg`;
	},
}));
beforeEach(() => cleanup());

const desktop = {
	mediaId: "00000000-0000-4000-8000-000000000002",
	focal: { x: 25, y: 75 },
	decorative: true as const,
};
const mobile = {
	mediaId: "00000000-0000-4000-8000-000000000003",
	focal: { x: 70, y: 30 },
	decorative: true as const,
};
const mediaBackground = (withMobile = true): StorefrontBackground => ({
	kind: "media",
	media: desktop,
	...(withMobile ? { mobile } : {}),
	overlay: { color: { hex: "#123456" }, alpha: 25 },
});

describe("GlobalBackgroundBackdrop", () => {
	it("uses the desktop still and focal point for desktop/tablet preview", () => {
		render(
			<GlobalBackgroundBackdrop
				background={mediaBackground()}
				presentation={DEFAULT_PRESENTATION_CONFIG}
				viewport="desktop"
			/>,
		);
		const layer = document.querySelector("[data-global-background-layer]");
		const image = layer?.querySelector("img");
		expect(image?.getAttribute("src")).toContain(desktop.mediaId);
		expect(image?.style.objectPosition).toBe("25% 75%");
		expect(
			layer
				?.querySelector("[data-global-background-overlay]")
				?.getAttribute("style"),
		).toContain("opacity: 0.25");
	});

	it("selects the mobile still and its focal point in the simulated mobile canvas", () => {
		render(
			<GlobalBackgroundBackdrop
				background={mediaBackground()}
				presentation={DEFAULT_PRESENTATION_CONFIG}
				viewport="mobile"
			/>,
		);
		const layer = document.querySelector("[data-global-background-layer]");
		const image = layer?.querySelector("img");
		expect(image?.getAttribute("src")).toContain(mobile.mediaId);
		expect(image?.style.objectPosition).toBe("70% 30%");
	});

	it("falls back to desktop when there is no mobile media, and hides safely when desktop is unavailable", () => {
		const { rerender } = render(
			<GlobalBackgroundBackdrop
				background={mediaBackground(false)}
				presentation={DEFAULT_PRESENTATION_CONFIG}
				viewport="mobile"
			/>,
		);
		expect(document.querySelector("img")?.getAttribute("src")).toContain(
			desktop.mediaId,
		);
		rerender(
			<GlobalBackgroundBackdrop
				background={{
					kind: "media",
					media: {
						...desktop,
						mediaId: "00000000-0000-4000-8000-000000000001",
					},
				}}
				presentation={DEFAULT_PRESENTATION_CONFIG}
				viewport="desktop"
			/>,
		);
		expect(document.querySelector("[data-global-background-layer]")).toBeNull();
	});

	it("renders no animation UI and never requests an animation URL", () => {
		render(
			<GlobalBackgroundBackdrop
				background={mediaBackground()}
				presentation={DEFAULT_PRESENTATION_CONFIG}
				viewport="desktop"
			/>,
		);
		expect(document.querySelector("video")).toBeNull();
		expect(document.querySelector("[data-motion-toggle]")).toBeNull();
		expect(document.querySelector("img")?.getAttribute("src")).not.toContain(
			"animated",
		);
	});
});
