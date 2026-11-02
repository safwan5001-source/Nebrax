import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrackingRouteTelemetryGate } from "../TrackingRouteTelemetryGate";

const pathname = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => pathname() }));

const TOKEN = "trk1.0a1b2c3d-0000-4000-8000-000000000001.1893456000.deadbeef";

describe("TrackingRouteTelemetryGate (COPS-H2-5 review)", () => {
  afterEach(cleanup);

  it("mounts telemetry on ordinary pages", () => {
    pathname.mockReturnValue("/sa/en/products/rose");
    render(
      <TrackingRouteTelemetryGate>
        <div>telemetry</div>
      </TrackingRouteTelemetryGate>,
    );
    expect(screen.getByText("telemetry")).toBeTruthy();
  });

  it("mounts nothing on a guest tracking page", () => {
    pathname.mockReturnValue(`/sa/ar/track/${TOKEN}`);
    const { container } = render(
      <TrackingRouteTelemetryGate>
        <div>telemetry</div>
      </TrackingRouteTelemetryGate>,
    );
    expect(container.textContent).toBe("");
  });

  it("fails closed in the shell: every third-party telemetry script sits behind the gate", () => {
    const source = readFileSync(
      join(__dirname, "../DocumentShell.tsx"),
      "utf8",
    );
    // Each tag must be inside a TrackingRouteTelemetryGate element, never bare.
    for (const tag of ["<GoogleTagManager", "<VercelTelemetry"]) {
      const at = source.indexOf(tag);
      expect(at, tag).toBeGreaterThan(-1);
      const gateOpen = source.lastIndexOf("<TrackingRouteTelemetryGate>", at);
      const gateClose = source.lastIndexOf("</TrackingRouteTelemetryGate>", at);
      expect(gateOpen, `${tag} is not wrapped`).toBeGreaterThan(gateClose);
    }
    // The Vercel packages must not be rendered (or given function props) from this Server Component.
    expect(source).not.toMatch(/<(Analytics|SpeedInsights)\b/);
    expect(source).not.toContain("beforeSend");
  });

  it("attaches the Vercel beforeSend callbacks inside a Client Component (functions cannot cross the server boundary)", () => {
    const source = readFileSync(
      join(__dirname, "../VercelTelemetry.tsx"),
      "utf8",
    );
    expect(source.trimStart().startsWith('"use client"')).toBe(true);
    expect(source.match(/beforeSend=\{redactTrackingEventUrl\}/g)).toHaveLength(
      2,
    );
  });
});
