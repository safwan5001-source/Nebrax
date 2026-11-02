import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VercelTelemetry } from "../VercelTelemetry";

const analytics = vi.fn();
const insights = vi.fn();
vi.mock("@vercel/analytics/next", () => ({
  Analytics: (props: unknown) => {
    analytics(props);
    return null;
  },
}));
vi.mock("@vercel/speed-insights/next", () => ({
  SpeedInsights: (props: unknown) => {
    insights(props);
    return null;
  },
}));

const TOKEN = "trk1.0a1b2c3d-0000-4000-8000-000000000001.1893456000.deadbeef";

describe("VercelTelemetry (COPS-H2-5 review)", () => {
  it("renders both Vercel components with a callback that strips the tracking token", () => {
    render(<VercelTelemetry />);
    for (const mock of [analytics, insights]) {
      const props = mock.mock.calls[0][0] as {
        beforeSend: (e: { url: string }) => { url: string };
      };
      expect(
        props.beforeSend({ url: `https://s.example/sa/en/track/${TOKEN}` }).url,
      ).toBe("https://s.example/sa/en/track/[redacted]");
    }
  });
});
