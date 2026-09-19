import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUSINESS_VERIFICATION_CAPABILITY,
  CUSTOMIZER_PREVIEW_CAPABILITY,
  DRAFT_PERSISTENCE_CAPABILITY,
  PUBLISH_CAPABILITY,
  THEME_PERSISTENCE_CAPABILITY,
  VERSION_HISTORY_CAPABILITY,
} from "@/lib/presentation/capabilities";

const DIR = join(__dirname, "..");
const LIB = join(__dirname, "../../../lib/presentation");

function sources(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
    .filter((name) => !name.includes(".test."))
    .map((name) => readFileSync(join(dir, name), "utf-8"));
}

describe("STORE-UI-6 architecture", () => {
  it("classifies customizer persistence correctly after STORE-BACKEND-1", () => {
    expect(THEME_PERSISTENCE_CAPABILITY).toBe("live");
    expect(DRAFT_PERSISTENCE_CAPABILITY).toBe("live");
    expect(CUSTOMIZER_PREVIEW_CAPABILITY).toBe("live");
    expect(PUBLISH_CAPABILITY).toBe("live");
    expect(BUSINESS_VERIFICATION_CAPABILITY).toBe("gated");
    expect(VERSION_HISTORY_CAPABILITY).toBe("deferred");
  });

  it("does not substitute browser storage for persistence", () => {
    const all = [...sources(DIR), ...sources(LIB)].join("\n");
    expect(all).not.toMatch(
      /\blocalStorage\.(get|set|remove)Item|\bsessionStorage\.(get|set|remove)Item/,
    );
  });

  it("does not invent a presentation API client", () => {
    const all = [...sources(DIR), ...sources(LIB)].join("\n");
    expect(all).not.toMatch(/storefrontFetch|axios/);
    expect(all).not.toMatch(/\/api\/commerce\/workspace\/storefronts\/\$\{/);
    expect(all).not.toMatch(/\/store\/v1\/presentation/);
  });

  it("does not render a Verified badge on the storefront preview", () => {
    const preview = readFileSync(
      join(DIR, "StorefrontPreviewCanvas.tsx"),
      "utf-8",
    );
    expect(preview).not.toMatch(/Verified/);
    expect(preview).not.toMatch(/موثّق/);
    expect(preview).not.toMatch(/requestedVerifiedLabel/);
  });
});
