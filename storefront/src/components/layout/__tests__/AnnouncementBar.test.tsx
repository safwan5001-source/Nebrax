import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnnouncementBar } from "@/components/layout/AnnouncementBar";
import {
  type AnnouncementsDoc,
  normalizeAnnouncements,
} from "@/lib/presentation/announcements";

let pathname = "/sa/ar";
let locale = "ar";

vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next-intl", () => ({
  useLocale: () => locale,
  useTranslations: () => (key: string, values?: Record<string, number>) =>
    ({
      region: "Announcements",
      previous: "Previous announcement",
      next: "Next announcement",
      pause: "Pause announcements",
      play: "Resume announcements",
      dismiss: "Dismiss announcement",
      position: `Announcement ${values?.current} of ${values?.total}`,
    })[key] ?? key,
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const NOW = Date.parse("2026-10-06T12:00:00Z");

function doc(items: unknown[], behaviour?: unknown, enabled = true) {
  return normalizeAnnouncements({
    enabled,
    items,
    behaviour,
  }) as AnnouncementsDoc;
}

function mountBar(d: AnnouncementsDoc) {
  return render(<AnnouncementBar doc={d} basePath="/sa/ar" serverNow={NOW} />);
}

function mockMedia(matching: string[]) {
  window.matchMedia = ((query: string) => ({
    matches: matching.some((m) => query.includes(m)),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe("AnnouncementBar (CUST-HV V3)", () => {
  beforeEach(() => {
    pathname = "/sa/ar";
    locale = "ar";
    mockMedia([]);
    window.localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    document.documentElement.style.removeProperty(
      "--store-announcement-height",
    );
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("quiet defaults", () => {
    it("shows only the first eligible item, as a labelled region that is not a live alert", () => {
      mountBar(
        doc([
          { id: "a", text: "off", enabled: false },
          { id: "b", text: "الأول" },
          { id: "c", text: "الثاني" },
        ]),
      );

      const region = screen.getByRole("region", { name: "Announcements" });
      expect(region.textContent).toContain("الأول");
      expect(region.textContent).not.toContain("الثاني");
      expect(region.querySelector('[role="alert"],[aria-live]')).toBeNull();
      expect(region.getAttribute("data-mode")).toBe("static");
      expect(region.querySelectorAll("button")).toHaveLength(0);
    });

    it("renders nothing for a disabled bar, an empty list or when every item is ineligible", () => {
      const { container, rerender } = mountBar(
        doc([{ id: "a", text: "x" }], undefined, false),
      );
      expect(container.firstChild).toBeNull();
      rerender(
        <AnnouncementBar doc={doc([])} basePath="/sa/ar" serverNow={NOW} />,
      );
      expect(container.firstChild).toBeNull();
      rerender(
        <AnnouncementBar
          doc={doc([{ id: "a", text: "x", window: { endsAt: "garbage" } }])}
          basePath="/sa/ar"
          serverNow={NOW}
        />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("themes itself from the store tokens unless the merchant chose a surface", () => {
      const { container } = mountBar(doc([{ id: "a", text: "x" }]));
      const bar = container.querySelector(
        "[data-announcement-bar]",
      ) as HTMLElement;
      expect(bar.className).toContain("bg-store-primary");
      expect(bar.style.backgroundColor).toBe("");
    });
  });

  describe("windows and pages", () => {
    it("starts and stops by itself at the window boundaries, without a reload", () => {
      mountBar(
        doc([
          {
            id: "a",
            text: "قريباً",
            window: {
              startsAt: "2026-10-06T12:00:05Z",
              endsAt: "2026-10-06T12:00:20Z",
            },
          },
        ]),
      );
      expect(screen.queryByText("قريباً")).toBeNull();

      act(() => {
        vi.setSystemTime(NOW + 6000);
        vi.advanceTimersByTime(6000);
      });
      expect(screen.getByText("قريباً")).toBeTruthy();

      act(() => {
        vi.setSystemTime(NOW + 21000);
        vi.advanceTimersByTime(15000);
      });
      expect(screen.queryByText("قريباً")).toBeNull();
    });

    it("targets pages and never shows on cart, checkout or account", () => {
      const d = doc([
        { id: "a", text: "للجميع", pages: ["all"] },
        { id: "b", text: "للمنتج", pages: ["product"] },
      ]);

      pathname = "/sa/ar/products/mug";
      const view = mountBar(d);
      expect(screen.getByRole("region").textContent).toContain("للجميع");

      for (const blocked of [
        "/sa/ar/cart",
        "/sa/ar/checkout",
        "/sa/ar/account/orders",
      ]) {
        pathname = blocked;
        view.rerender(
          <AnnouncementBar doc={d} basePath="/sa/ar" serverNow={NOW} />,
        );
        expect(screen.queryByRole("region"), blocked).toBeNull();
      }
    });

    it("an item targeted at product skips Home and shows on a product page", () => {
      const d = doc([{ id: "b", text: "للمنتج", pages: ["product"] }]);
      const view = mountBar(d);
      expect(screen.queryByRole("region")).toBeNull();
      pathname = "/sa/ar/products/mug";
      view.rerender(
        <AnnouncementBar doc={d} basePath="/sa/ar" serverNow={NOW} />,
      );
      expect(screen.getByRole("region").textContent).toContain("للمنتج");
    });
  });

  describe("links and icons", () => {
    it("prefixes internal links with the storefront base path and opens external ones safely", () => {
      mountBar(
        doc([{ id: "a", text: "عروض", href: "/products?sale=1", icon: "tag" }]),
      );
      const internal = screen.getByRole("link", { name: "عروض" });
      expect(internal.getAttribute("href")).toBe("/sa/ar/products?sale=1");
      expect(internal.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
        "true",
      );
    });

    it("external links get rel=noopener noreferrer", () => {
      mountBar(
        doc([{ id: "a", text: "تابعنا", href: "https://example.com/promo" }]),
      );
      const link = screen.getByRole("link", { name: "تابعنا" });
      expect(link.getAttribute("href")).toBe("https://example.com/promo");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      expect(link.getAttribute("target")).toBe("_blank");
    });
  });

  describe("colours", () => {
    it("applies a custom surface and replaces an unreadable text colour with a provably readable one", () => {
      const { container } = mountBar(
        doc([
          {
            id: "a",
            text: "x",
            surface: {
              background: { hex: "#ffffff" },
              text: { hex: "#777777" },
            },
          },
        ]),
      );
      const bar = container.querySelector(
        "[data-announcement-bar]",
      ) as HTMLElement;
      expect(bar.style.backgroundColor).toBe("rgb(255, 255, 255)");
      expect(bar.style.color).toBe("rgb(0, 0, 0)");
    });
  });

  describe("dismissal", () => {
    const d = () =>
      doc(
        [
          { id: "promo", text: "خصم" },
          { id: "next", text: "التالي" },
        ],
        { dismissible: true },
      );

    it("is per announcement, persisted per browser under awj.ann.<id>.<hash>, with no user or tenant id", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mountBar(d());

      await user.click(
        screen.getByRole("button", { name: "Dismiss announcement" }),
      );

      const keys = Object.keys(window.localStorage);
      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatch(/^awj\.ann\.promo\.[0-9a-f]{8}$/);
      expect(window.localStorage.getItem(keys[0])).toBe("1");
      // The next eligible message takes its place; the dismissed one is gone.
      expect(screen.getByRole("region").textContent).toContain("التالي");
      expect(screen.getByRole("region").textContent).not.toContain("خصم");
    });

    it("stays dismissed after a reload and comes back when the message is edited", () => {
      mountBar(d());
      fireEvent.click(
        screen.getByRole("button", { name: "Dismiss announcement" }),
      );

      const reloaded = render(
        <AnnouncementBar doc={d()} basePath="/sa/ar" serverNow={NOW} />,
      );
      expect(reloaded.container.textContent).not.toContain("خصم");

      const edited = doc([{ id: "promo", text: "خصم 25٪" }], {
        dismissible: true,
      });
      const again = render(
        <AnnouncementBar doc={edited} basePath="/sa/ar" serverNow={NOW} />,
      );
      expect(again.container.textContent).toContain("خصم 25٪");
    });

    it("falls back to the page session when storage is unavailable", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const spy = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw new Error("blocked");
        });
      mountBar(doc([{ id: "only", text: "وحيد" }], { dismissible: true }));

      await user.click(
        screen.getByRole("button", { name: "Dismiss announcement" }),
      );

      expect(screen.queryByRole("region")).toBeNull();
      spy.mockRestore();
    });

    it("offers no dismiss control unless the merchant turned it on", () => {
      mountBar(doc([{ id: "a", text: "x" }]));
      expect(
        screen.queryByRole("button", { name: "Dismiss announcement" }),
      ).toBeNull();
    });
  });

  describe("rotation (opt-in)", () => {
    const rotating = () =>
      doc(
        [
          { id: "a", text: "أ" },
          { id: "b", text: "ب" },
          { id: "c", text: "ج" },
        ],
        { rotate: true, rotateInterval: 6 },
      );
    const shown = () =>
      screen.getByRole("region").querySelector("p")?.textContent;

    it("advances every interval and wraps", () => {
      mountBar(rotating());
      expect(shown()).toBe("أ");
      act(() => void vi.advanceTimersByTime(6000));
      expect(shown()).toBe("ب");
      act(() => void vi.advanceTimersByTime(6000));
      expect(shown()).toBe("ج");
      act(() => void vi.advanceTimersByTime(6000));
      expect(shown()).toBe("أ");
    });

    it("never runs faster than the contract floor", () => {
      mountBar(rotating());
      act(() => void vi.advanceTimersByTime(5900));
      expect(shown()).toBe("أ");
    });

    it("pauses on hover, on focus and via the visible pause button", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mountBar(rotating());
      const region = screen.getByRole("region");

      fireEvent.mouseEnter(region);
      act(() => void vi.advanceTimersByTime(30000));
      expect(shown()).toBe("أ");
      fireEvent.mouseLeave(region);
      act(() => void vi.advanceTimersByTime(6000));
      expect(shown()).toBe("ب");

      await user.click(
        screen.getByRole("button", { name: "Pause announcements" }),
      );
      act(() => void vi.advanceTimersByTime(30000));
      expect(shown()).toBe("ب");
      const resume = screen.getByRole("button", {
        name: "Resume announcements",
      });
      expect(resume.getAttribute("aria-pressed")).toBe("true");
      await user.click(resume);
      // The button keeps focus, but an explicit Play must win over focus-pause.
      act(() => void vi.advanceTimersByTime(6000));
      expect(shown()).toBe("ج");
    });

    it("pauses while keyboard focus is inside the bar", () => {
      mountBar(rotating());
      fireEvent.focus(
        screen.getByRole("button", { name: "Next announcement" }),
      );
      act(() => void vi.advanceTimersByTime(30000));
      expect(shown()).toBe("أ");
      fireEvent.blur(screen.getByRole("button", { name: "Next announcement" }));
      act(() => void vi.advanceTimersByTime(6000));
      expect(shown()).toBe("ب");
    });

    it("pauses while the shopper is touching it", () => {
      mountBar(rotating());
      fireEvent.touchStart(screen.getByRole("region"));
      act(() => void vi.advanceTimersByTime(4000));
      expect(shown()).toBe("أ");
    });

    it("has manual previous / next with a position the screen reader can read", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mountBar(rotating());

      await user.click(
        screen.getByRole("button", { name: "Next announcement" }),
      );
      expect(shown()).toBe("ب");
      await user.click(
        screen.getByRole("button", { name: "Previous announcement" }),
      );
      await user.click(
        screen.getByRole("button", { name: "Previous announcement" }),
      );
      expect(shown()).toBe("ج");
      expect(screen.getByRole("region").textContent).toContain(
        "Announcement 3 of 3",
      );
    });

    it("every control is a real button of at least 44px", () => {
      mountBar(
        doc(
          [
            { id: "a", text: "أ" },
            { id: "b", text: "ب" },
          ],
          { rotate: true, dismissible: true },
        ),
      );
      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(4);
      for (const button of buttons)
        expect(button.className).toContain("size-11");
    });

    it("a single eligible item never rotates and shows no rotation controls", () => {
      mountBar(doc([{ id: "a", text: "وحيد" }], { rotate: true }));
      expect(screen.queryByRole("button")).toBeNull();
    });
  });

  describe("reduced motion", () => {
    it("shows the first eligible item statically — no rotation, no ticker, no pause control", () => {
      mockMedia(["prefers-reduced-motion"]);
      mountBar(
        doc(
          [
            { id: "a", text: "أ" },
            { id: "b", text: "ب" },
          ],
          { rotate: true },
        ),
      );
      act(() => void vi.advanceTimersByTime(60000));

      const region = screen.getByRole("region");
      expect(region.getAttribute("data-mode")).toBe("static");
      expect(region.textContent).toContain("أ");
      expect(region.textContent).not.toContain("ب");
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("a ticker is static too", () => {
      mockMedia(["prefers-reduced-motion"]);
      mountBar(
        doc(
          [
            { id: "a", text: "أ" },
            { id: "b", text: "ب" },
          ],
          { ticker: true },
        ),
      );
      expect(screen.getByRole("region").getAttribute("data-mode")).toBe(
        "static",
      );
      expect(document.querySelector(".awj-ann-track")).toBeNull();
    });
  });

  describe("ticker (opt-in)", () => {
    const ticker = (extra: Record<string, unknown> = {}) =>
      doc(
        [
          { id: "a", text: "شحن مجاني" },
          { id: "b", text: "خصم 20٪", href: "/offers" },
        ],
        { ticker: true, ...extra },
      );

    it("keeps the first copy (links included) in the accessibility tree and removes only the loop duplicate from AT and tab order", () => {
      mountBar(ticker());
      const region = screen.getByRole("region");
      expect(region.getAttribute("data-mode")).toBe("ticker");
      const track = region.querySelector(".awj-ann-track") as HTMLElement;
      expect(track.getAttribute("aria-hidden")).toBeNull();
      const [first, second] = Array.from(track.querySelectorAll("ul"));
      expect(first.getAttribute("aria-hidden")).toBeNull();
      expect(first.hasAttribute("inert")).toBe(false);
      expect(second.getAttribute("aria-hidden")).toBe("true");
      expect(second.hasAttribute("inert")).toBe(true);
      // The only reachable link is the real one — and it is *not* hidden from AT.
      expect(first.querySelectorAll("a")).toHaveLength(1);
      expect(
        first.querySelector("a")?.closest("[aria-hidden='true']"),
      ).toBeNull();
      // No duplicated off-screen text: nothing is read twice.
      expect(region.querySelector(".sr-only")).toBeNull();
    });

    it("travels the way the text reads: mirrored in RTL, natural in LTR", () => {
      locale = "ar";
      const rtl = mountBar(ticker());
      expect(
        (
          rtl.container.querySelector(".awj-ann-viewport") as HTMLElement
        ).style.getPropertyValue("--ann-dir"),
      ).toBe("-1");
      rtl.unmount();

      locale = "en";
      const ltr = mountBar(ticker());
      expect(
        (
          ltr.container.querySelector(".awj-ann-viewport") as HTMLElement
        ).style.getPropertyValue("--ann-dir"),
      ).toBe("1");
    });

    it("speed presets change the duration; the pause button stops the animation", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const slow = mountBar(ticker({ tickerSpeed: "slow" }));
      const slowDuration = (
        slow.container.querySelector(".awj-ann-viewport") as HTMLElement
      ).style.getPropertyValue("--ann-duration");
      slow.unmount();
      const fast = mountBar(ticker({ tickerSpeed: "fast" }));
      const fastDuration = (
        fast.container.querySelector(".awj-ann-viewport") as HTMLElement
      ).style.getPropertyValue("--ann-duration");
      expect(Number.parseInt(slowDuration)).toBeGreaterThan(
        Number.parseInt(fastDuration),
      );

      await user.click(
        screen.getByRole("button", { name: "Pause announcements" }),
      );
      expect(screen.getByRole("region").className).toContain("awj-ann-paused");
    });

    it("pauses while hovered or focused", () => {
      mountBar(ticker());
      const region = screen.getByRole("region");
      fireEvent.mouseEnter(region);
      expect(region.className).toContain("awj-ann-paused");
      fireEvent.mouseLeave(region);
      expect(region.className).not.toContain("awj-ann-paused");
    });

    it("dismissing a ticker dismisses everything it was showing", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      mountBar(ticker({ dismissible: true }));
      await user.click(
        screen.getByRole("button", { name: "Dismiss announcement" }),
      );
      expect(screen.queryByRole("region")).toBeNull();
      expect(Object.keys(window.localStorage)).toHaveLength(2);
    });
  });

  describe("sticky (opt-in)", () => {
    const stickyDoc = () => doc([{ id: "a", text: "ثابت" }], { sticky: true });

    it("tells the header how tall the band is, and clears it on unmount", () => {
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(
        40,
      );
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe() {}
          disconnect() {}
        },
      );
      const view = mountBar(stickyDoc());
      expect(
        document.documentElement.style.getPropertyValue(
          "--store-announcement-height",
        ),
      ).toBe("40px");
      view.unmount();
      expect(
        document.documentElement.style.getPropertyValue(
          "--store-announcement-height",
        ),
      ).toBe("");
      vi.unstubAllGlobals();
    });

    it("is not sticky by default and publishes no offset", () => {
      const { container } = mountBar(doc([{ id: "a", text: "x" }]));
      expect(container.querySelector("[data-sticky]")).toBeNull();
      expect(
        document.documentElement.style.getPropertyValue(
          "--store-announcement-height",
        ),
      ).toBe("");
    });

    it("below md it collapses on scroll-down, returns on scroll-up and is inert while collapsed", () => {
      mockMedia(["max-width: 47.99rem"]);
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe() {}
          disconnect() {}
        },
      );
      mountBar(stickyDoc());
      const region = screen.getByRole("region", { hidden: true });
      expect(region.hasAttribute("inert")).toBe(false);

      const scrollTo = (y: number) => {
        Object.defineProperty(window, "scrollY", {
          value: y,
          configurable: true,
        });
        fireEvent.scroll(window);
      };
      scrollTo(0);
      scrollTo(200);
      expect(region.hasAttribute("inert")).toBe(true);
      expect(region.className).toContain("-translate-y-full");
      expect(
        document.documentElement.style.getPropertyValue(
          "--store-announcement-height",
        ),
      ).toBe("");

      scrollTo(150);
      expect(region.hasAttribute("inert")).toBe(false);
      vi.unstubAllGlobals();
    });

    it("on larger screens it never collapses", () => {
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe() {}
          disconnect() {}
        },
      );
      mountBar(stickyDoc());
      Object.defineProperty(window, "scrollY", {
        value: 900,
        configurable: true,
      });
      fireEvent.scroll(window);
      expect(screen.getByRole("region").hasAttribute("inert")).toBe(false);
      vi.unstubAllGlobals();
    });
  });
});
