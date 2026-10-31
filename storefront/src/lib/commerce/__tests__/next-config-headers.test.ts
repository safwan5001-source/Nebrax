import { describe, expect, it } from "vitest";
import nextConfig from "../../../../next.config";

/**
 * H6 Final Closure — the storefront's baseline response headers. They must stay behavior-neutral, so the policy is
 * pinned here: HSTS without includeSubDomains/preload (tenants own their domains), framing denied, and NO
 * resource-restricting CSP (that needs an origin inventory and a report-only soak first).
 */
describe("storefront security headers", () => {
  async function headers() {
    const rules = await (
      nextConfig as {
        headers: () => Promise<
          Array<{
            source: string;
            headers: Array<{ key: string; value: string }>;
          }>
        >;
      }
    ).headers();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
    return Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]));
  }

  it("sets the baseline set on every path", async () => {
    const h = await headers();
    expect(h["Strict-Transport-Security"]).toBe("max-age=31536000");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Permissions-Policy"]).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
  });

  it("does not pin sibling subdomains or preload", async () => {
    const hsts = (await headers())["Strict-Transport-Security"];
    expect(hsts).not.toMatch(/includeSubDomains|preload/i);
  });

  it("sets only frame-ancestors in the CSP — no resource restriction that could break scripts, images or payments", async () => {
    const csp = (await headers())["Content-Security-Policy"];
    expect(csp).toBe("frame-ancestors 'none'");
    for (const directive of [
      "default-src",
      "script-src",
      "img-src",
      "connect-src",
      "style-src",
      "form-action",
    ]) {
      expect(csp).not.toContain(directive);
    }
  });
});
