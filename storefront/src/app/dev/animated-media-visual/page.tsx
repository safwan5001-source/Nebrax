import { notFound } from "next/navigation";
import { HomeSlider, type SliderLabels } from "@/components/home/HomeSlider";
import { SectionBackdrop } from "@/components/home/SectionBackdrop";
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
 * `?scenario=` desktop-gif | desktop-webp | phone-gif | static | slider · `?locale=` ar | en
 */
const ID = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const P = `/api/storefront/media/customizer/${ID}`;

type Scenario =
  | "desktop-gif"
  | "desktop-webp"
  | "phone-gif"
  | "static"
  | "slider";

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

export default async function AnimatedMediaVisualPage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string; locale?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const locale = params.locale === "ar" ? "ar" : "en";
  const scenario: Scenario =
    params.scenario === "desktop-webp" ||
    params.scenario === "phone-gif" ||
    params.scenario === "static" ||
    params.scenario === "slider"
      ? params.scenario
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
        {scenario === "slider" ? (
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
