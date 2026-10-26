import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { config } from "./proxy";

const require = createRequire(import.meta.url);
const {
  getMiddlewareMatchers,
} = require("next/dist/build/analysis/get-page-static-info");
const {
  getMiddlewareRouteMatcher,
} = require("next/dist/shared/lib/router/utils/middleware-route-matcher");

function proxyRuns(pathname: string): boolean {
  const matchers = getMiddlewareMatchers(config.matcher, {});
  return getMiddlewareRouteMatcher(matchers)(pathname);
}

describe("storefront proxy matcher", () => {
  it("does not run the locale proxy for the exact /icon route", () => {
    expect(proxyRuns("/icon")).toBe(false);
    expect(proxyRuns("/icon/")).toBe(false);
  });

  it("still runs the locale proxy for / and storefront pages", () => {
    expect(proxyRuns("/")).toBe(true);
    expect(proxyRuns("/products")).toBe(true);
    expect(proxyRuns("/sa/ar")).toBe(true);
    expect(proxyRuns("/sa/ar/products")).toBe(true);
  });

  it("keeps favicon, api, next, and dotted assets excluded", () => {
    expect(proxyRuns("/favicon.ico")).toBe(false);
    expect(proxyRuns("/api/storefront")).toBe(false);
    expect(proxyRuns("/_next/static/chunk.js")).toBe(false);
    expect(proxyRuns("/_next/image")).toBe(false);
    expect(proxyRuns("/icon.png")).toBe(false);
  });

  it("does not exclude a different path that merely starts with icon", () => {
    expect(proxyRuns("/icons")).toBe(true);
  });

  it("X5b: runs the proxy for dotted legacy checkout ids and nothing else dotted", () => {
    for (const path of [
      "/sa/ar/checkout/test.123",
      "/sa/ar/confirm-payment/test.123",
      "/sa/ar/order-placed/test.123",
    ]) {
      expect(proxyRuns(path)).toBe(true);
    }

    // Static assets, API, framework internals and unrelated dotted paths stay skipped.
    for (const path of [
      "/logo.png",
      "/favicon.ico",
      "/_next/static/chunks/app.js",
      "/_next/image",
      "/api/health.json",
      "/sa/ar/products/shirt.v2",
      "/sa/ar/checkout/test.123/extra",
      "/sa/ar/checkout.v2/test",
      "/sa/ar/wholesale/checkout/test.123",
      "/checkout/test.123",
      "/sa/ar/cart/test.123",
    ]) {
      expect(proxyRuns(path)).toBe(false);
    }
  });
});
