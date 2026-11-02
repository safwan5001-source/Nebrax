import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isTrackingPath,
  redactTrackingEventUrl,
  redactTrackingPath,
  scrubTrackingCredentials,
} from "../scrub-tracking";

const TOKEN =
  "trk1.0a1b2c3d-0000-4000-8000-000000000001.1893456000.deadbeefdeadbeef";

describe("guest tracking token scrubbing (COPS-H2-5 review)", () => {
  it("redacts the token segment in paths and absolute URLs, keeping the rest", () => {
    expect(redactTrackingPath(`/sa/en/track/${TOKEN}`)).toBe(
      "/sa/en/track/[redacted]",
    );
    expect(
      redactTrackingPath(`https://shop.example/sa/ar/track/${TOKEN}?x=1#h`),
    ).toBe("https://shop.example/sa/ar/track/[redacted]?x=1#h");
    expect(redactTrackingPath("/sa/en/products/track-suit")).toBe(
      "/sa/en/products/track-suit",
    );
  });

  it("scrubs every place an event carries the URL", () => {
    const event = {
      request: {
        url: `https://shop.example/sa/en/track/${TOKEN}`,
        headers: { Referer: `https://shop.example/sa/en/track/${TOKEN}` },
      },
      transaction: `/sa/en/track/${TOKEN}`,
      breadcrumbs: [
        { category: "navigation", data: { from: "/", to: `/track/${TOKEN}` } },
        { category: "fetch", data: { url: `/api/track/${TOKEN}` } },
      ],
      spans: [{ description: `GET /sa/en/track/${TOKEN}` }],
      exception: { values: [{ value: `failed at /track/${TOKEN}` }] },
    };
    expect(JSON.stringify(scrubTrackingCredentials(event))).not.toContain(
      TOKEN,
    );
    expect(JSON.stringify(event)).not.toContain("trk1.");
  });

  it("survives cycles and never throws into the app", () => {
    const cyclic: Record<string, unknown> = { url: `/track/${TOKEN}` };
    cyclic.self = cyclic;
    expect(() => scrubTrackingCredentials(cyclic)).not.toThrow();
    expect(cyclic.url).toBe("/track/[redacted]");
    expect(scrubTrackingCredentials(null)).toBeNull();
  });

  it("is wired into both Sentry inits (client and server) for events, transactions and breadcrumbs", () => {
    for (const file of ["instrumentation-client.ts", "instrumentation.ts"]) {
      const source = readFileSync(join(__dirname, "../../..", file), "utf8");
      expect(source).toContain("scrubTrackingCredentials");
      for (const hook of [
        "beforeSend:",
        "beforeSendTransaction:",
        "beforeBreadcrumb:",
      ]) {
        expect(source, `${file} ${hook}`).toContain(hook);
      }
    }
  });

  it("recognises tracking pages only, and redacts analytics event URLs", () => {
    expect(isTrackingPath(`/sa/en/track/${TOKEN}`)).toBe(true);
    expect(isTrackingPath("/sa/en/products/track-suit")).toBe(false);
    expect(isTrackingPath("/sa/en/track")).toBe(false);
    expect(isTrackingPath(null)).toBe(false);
    expect(
      redactTrackingEventUrl({
        type: "pageview",
        url: `https://shop.example/sa/en/track/${TOKEN}`,
      }).url,
    ).toBe("https://shop.example/sa/en/track/[redacted]");
  });
});
