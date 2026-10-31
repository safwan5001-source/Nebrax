// @vitest-environment node
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handlers = vi.hoisted(() => ({
  handleOrderCompleted: vi.fn(async () => {}),
  handleOrderCanceled: vi.fn(async () => {}),
  handleOrderShipped: vi.fn(async () => {}),
  handlePasswordReset: vi.fn(async () => {}),
}));
vi.mock("@/lib/webhooks/handlers", () => handlers);

import { POST } from "./route";

const SECRET = "whsec_route_test";
const NOW_S = 1_800_000_000;

function request(
  body: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest("https://store.test/api/webhooks/spree", {
    method: "POST",
    body,
    headers,
  });
}

function signed(body: string, ts = NOW_S, secret = SECRET) {
  return {
    "x-spree-webhook-signature": createHmac("sha256", secret)
      .update(`${ts}.${body}`)
      .digest("hex"),
    "x-spree-webhook-timestamp": String(ts),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_S * 1000);
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/webhooks/spree (retained external contract — D-14)", () => {
  const event = JSON.stringify({
    id: "evt_1",
    name: "order.completed",
    created_at: "2026-01-01T00:00:00Z",
    data: { number: "R1" },
    metadata: { spree_version: "5" },
  });

  it("answers 503 and never runs a handler while the secret is unset (the deployed state)", async () => {
    vi.stubEnv("SPREE_WEBHOOK_SECRET", "");
    const response = await POST(request(event, signed(event)));
    expect(response.status).toBe(503);
    expect(handlers.handleOrderCompleted).not.toHaveBeenCalled();
  });

  it("rejects a request without signature headers (401)", async () => {
    vi.stubEnv("SPREE_WEBHOOK_SECRET", SECRET);
    const response = await POST(request(event));
    expect(response.status).toBe(401);
    expect(handlers.handleOrderCompleted).not.toHaveBeenCalled();
  });

  it("rejects a forged signature (401) and a replayed old timestamp (401)", async () => {
    vi.stubEnv("SPREE_WEBHOOK_SECRET", SECRET);
    const forged = await POST(
      request(event, signed(event, NOW_S, "not-the-secret")),
    );
    expect(forged.status).toBe(401);
    const replay = await POST(request(event, signed(event, NOW_S - 3600)));
    expect(replay.status).toBe(401);
    expect(handlers.handleOrderCompleted).not.toHaveBeenCalled();
  });

  it("dispatches a correctly signed, fresh event to its handler (200)", async () => {
    vi.stubEnv("SPREE_WEBHOOK_SECRET", SECRET);
    const response = await POST(
      request(event, {
        ...signed(event),
        "x-spree-webhook-event": "order.completed",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, handled: true });
    expect(handlers.handleOrderCompleted).toHaveBeenCalledOnce();
  });

  it("acknowledges an unhandled event name without running anything (200, handled:false)", async () => {
    vi.stubEnv("SPREE_WEBHOOK_SECRET", SECRET);
    const other = JSON.stringify({ id: "e2", name: "product.updated" });
    const response = await POST(request(other, signed(other)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, handled: false });
  });
});
