import { notFound } from "next/navigation";
import { HomeGallery } from "@/components/home/HomeGallery";
import { HomeSlider, type SliderLabels } from "@/components/home/HomeSlider";
import { SectionBackdrop } from "@/components/home/SectionBackdrop";
import { resolveGalleryOptions } from "@/lib/presentation/gallery-content";
import type { GalleryImageView } from "@/lib/presentation/gallery-resolve";
import type { ResolvedMedia } from "@/lib/presentation/media-ref";
import { resolveSliderBehaviour } from "@/lib/presentation/slider-content";
import type { SlideView } from "@/lib/presentation/slider-resolve";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";
import { PublishedFrame } from "../customizer-visual/frame";

/**
 * AWJ-ANIMATED-MEDIA P1 — development-only visual fixture for animated media. Mounts the REAL `SectionBackdrop`
 * and `HomeSlider` against resolved media whose URLs are the same-origin proxy paths; the Playwright spec
 * (`e2e/animated-media-visual.spec.ts`) answers those paths with the sanitised fixtures. Production requests 404.
 *
 * `?scenario=` desktop-gif | desktop-webp | phone-gif | static | slider | gallery-gif | gallery-webp | gallery-controls |
 * gallery-static | gallery-offscreen | gallery-offscreen-controls (a 3000px spacer puts the gallery below the fold) · `?locale=` ar | en (gallery: animated first picture, a still second, `-controls` = `showMotionControls`).
 */
const ID = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const P = `/api/storefront/media/customizer/${ID}`;

type Scenario =
  | "desktop-gif"
  | "desktop-webp"
  | "phone-gif"
  | "static"
  | "slider"
  | "gallery-gif"
  | "gallery-webp"
  | "gallery-controls"
  | "gallery-static"
  | "gallery-offscreen"
  | "gallery-offscreen-controls";

const GALLERY_SCENARIOS: readonly Scenario[] = [
  "gallery-gif",
  "gallery-webp",
  "gallery-controls",
  "gallery-static",
  "gallery-offscreen",
  "gallery-offscreen-controls",
];

const stills = (tag: string): ResolvedMedia["sources"] => [
  {
    kind: "w",
    width: 800,
    height: 400,
    format: "webp",
    src: `${P}/${tag}800w.webp`,
  },
  {
    kind: "w",
    width: 800,
    height: 400,
    format: "jpg",
    src: `${P}/${tag}800w.jpg`,
  },
];

function media(tag: string, animated?: "gif" | "webp"): ResolvedMedia {
  return {
    width: 800,
    height: 400,
    decorative: true,
    alt: { ar: null, en: null },
    sources: stills(tag),
    ...(animated
      ? {
          animation: {
            src: `${P}/animated.${animated}`,
            format: animated,
            frames: 3,
            durationMs: 600,
            loop: true,
          },
        }
      : {}),
  };
}

const LABELS: SliderLabels = {
  label: "Featured",
  slide: "{current} of {total}",
  previous: "Previous slide",
  next: "Next slide",
  goTo: "Go to slide {number}",
  pause: "Pause slides",
  play: "Play slides",
  choose: "Choose a slide",
};

function slide(i: number, animated?: "gif"): SlideView {
  return {
    id: `s${i}`,
    position: i + 1,
    media: media(`s${i}-`, animated),
    mobile: null,
    alt: `Slide ${i + 1}`,
    heading: `Heading ${i + 1}`,
    sub: "",
    cta: null,
    foreground: "#ffffff",
    buttonLabel: "#000000",
    overlay: null,
    align: "start",
    surface: "picture",
  };
}

function galleryImage(i: number, animated?: "gif" | "webp"): GalleryImageView {
  return {
    id: `g${i}`,
    position: i + 1,
    media: media(`g${i}-`, animated),
    fit: "cover",
    alt: `Picture ${i + 1}`,
    caption: "",
    link: null,
  };
}

const GALLERY_LABELS = {
  label: "Gallery",
  item: "Picture {number}",
  previous: "Previous pictures",
  next: "Next pictures",
  open: "View picture {number} larger",
  viewer: "Picture viewer",
  close: "Close viewer",
  viewerPrevious: "Previous picture",
  viewerNext: "Next picture",
  counter: "{current} of {total}",
};

export default async function AnimatedMediaVisualPage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string; locale?: string }>;
}) {
  // Read the request first: that makes the route dynamic, so production answers a real 404 per request.
  // Calling notFound() before touching searchParams lets Next prerender the route as a cached soft-404 (HTTP 200).
  const params = await searchParams;
  if (process.env.NODE_ENV === "production") notFound();
  const locale = params.locale === "ar" ? "ar" : "en";
  const scenario: Scenario =
    params.scenario === "desktop-webp" ||
    params.scenario === "phone-gif" ||
    params.scenario === "static" ||
    params.scenario === "slider" ||
    GALLERY_SCENARIOS.includes(params.scenario as Scenario)
      ? (params.scenario as Scenario)
      : "desktop-gif";

  const backdrop =
    scenario === "desktop-webp"
      ? { media: media("", "webp"), overlay: true }
      : scenario === "phone-gif"
        ? { media: media(""), mobile: media("m-", "gif"), overlay: true }
        : scenario === "static"
          ? { media: media(""), overlay: true }
          : { media: media("", "gif"), overlay: true };

  return (
    <PublishedFrame locale={locale} messages={locale === "ar" ? ar : en}>
      <div
        dir={locale === "ar" ? "rtl" : "ltr"}
        lang={locale}
        data-scenario={scenario}
        className="min-h-dvh bg-store-background text-store-foreground"
      >
        {GALLERY_SCENARIOS.includes(scenario) ? (
          <div style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
            {scenario.startsWith("gallery-offscreen") ? (
              <div aria-hidden="true" style={{ height: 3000 }} />
            ) : null}
            <HomeGallery
              view={{
                images: [
                  galleryImage(
                    0,
                    scenario === "gallery-static"
                      ? undefined
                      : scenario === "gallery-webp"
                        ? "webp"
                        : "gif",
                  ),
                  galleryImage(1),
                ],
                options: resolveGalleryOptions({
                  columns: 2,
                  lightbox: true,
                  ...(scenario === "gallery-controls" ||
                  scenario === "gallery-offscreen-controls"
                    ? { showMotionControls: true }
                    : {}),
                }),
                layout: "grid",
              }}
              labels={GALLERY_LABELS}
              basePath="/dev/animated-media-visual"
              dir={locale === "ar" ? "rtl" : "ltr"}
              priority
              sectionId="dev-gallery"
            />
          </div>
        ) : scenario === "slider" ? (
          <HomeSlider
            view={{
              slides: [slide(0, "gif"), slide(1), slide(2)],
              behaviour: resolveSliderBehaviour(undefined),
            }}
            labels={LABELS}
            basePath="/dev/animated-media-visual"
            dir={locale === "ar" ? "rtl" : "ltr"}
            sectionId="dev"
          />
        ) : (
          <section
            data-testid="hero"
            style={{ position: "relative", height: 320, overflow: "hidden" }}
          >
            <SectionBackdrop data={backdrop} priority />
            <h1
              style={{
                position: "relative",
                zIndex: 1,
                padding: 24,
                color: "#fff",
              }}
            >
              Animated hero
            </h1>
          </section>
        )}
      </div>
    </PublishedFrame>
  );
}
