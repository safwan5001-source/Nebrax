// @vitest-environment node
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyWebhookSignature } from "../signature";

const secret = "whsec_test_secret";
const body = JSON.stringify({
  id: "evt_1",
  name: "order.completed",
  created_at: "2026-01-01T00:00:00Z",
  data: { number: "R1" },
  metadata: { spree_version: "5" },
});
const NOW_S = 1_800_000_000;
const sign = (ts: number, b = body, s = secret) =>
  createHmac("sha256", s).update(`${ts}.${b}`).digest("hex");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_S * 1000);
});
afterEach(() => vi.useRealTimers());

/**
 * Outcomes recorded from the vendor SDK's `verifyWebhookSignature` (v1.2.1) for the same inputs before the SDK was
 * removed — this port must keep returning exactly these.
 */
describe("verifyWebhookSignature (parity with the removed SDK function)", () => {
  const cases: Array<
    [string, () => Parameters<typeof verifyWebhookSignature>, boolean]
  > = [
    ["valid", () => [body, sign(NOW_S), String(NOW_S), secret], true],
    [
      "valid at the edge of the default tolerance (299 s old)",
      () => [body, sign(NOW_S - 299), String(NOW_S - 299), secret],
      true,
    ],
    [
      "too old (301 s)",
      () => [body, sign(NOW_S - 301), String(NOW_S - 301), secret],
      false,
    ],
    [
      "too new (301 s ahead)",
      () => [body, sign(NOW_S + 301), String(NOW_S + 301), secret],
      false,
    ],
    [
      "custom tolerance, inside",
      () => [body, sign(NOW_S - 50), String(NOW_S - 50), secret, 60],
      true,
    ],
    [
      "custom tolerance, exceeded",
      () => [body, sign(NOW_S - 70), String(NOW_S - 70), secret, 60],
      false,
    ],
    [
      "signed with another secret",
      () => [body, sign(NOW_S, body, "other"), String(NOW_S), secret],
      false,
    ],
    [
      "tampered body",
      () => [`${body} `, sign(NOW_S), String(NOW_S), secret],
      false,
    ],
    ["non-numeric timestamp", () => [body, sign(NOW_S), "abc", secret], false],
    ["empty timestamp", () => [body, sign(NOW_S), "", secret], false],
    ["short signature", () => [body, "abcd", String(NOW_S), secret], false],
    ["empty signature", () => [body, "", String(NOW_S), secret], false],
    [
      "upper-case hex signature",
      () => [body, sign(NOW_S).toUpperCase(), String(NOW_S), secret],
      false,
    ],
  ];

  it.each(cases)("%s", (_name, args, expected) => {
    expect(verifyWebhookSignature(...args())).toBe(expected);
  });

  it("matches a fixed vector: HMAC-SHA256 over the timestamp, a dot and the payload, hex", () => {
    // Hex digest produced with the openssl CLI: printf '1800000000.{}' | openssl dgst -sha256 -hmac s3cret
    const expected =
      "1cd77f07c7f231a8a17cd9bc413e578ccb209c24eb17a0577ce1eb9218a4f3ed";
    expect(verifyWebhookSignature("{}", expected, "1800000000", "s3cret")).toBe(
      true,
    );
  });
});
