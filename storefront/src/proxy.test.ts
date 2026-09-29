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
});
