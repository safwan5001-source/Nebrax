import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNT_AUTH_CAPABILITY } from "@/lib/commerce/capabilities";

/**
 * SPREE-X1 structural guards for the gated buyer-account surface.
 *
 * While buyer authentication is `gated`, the Spree SDK must not be reachable
 * from the screens a shopper can hit, and every server action in
 * `lib/data/customer.ts` must check the gate BEFORE any Spree access. These are
 * source-level checks so a regression fails even if no runtime test exercises
 * the path.
 */
const SRC = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const ACCOUNT_PAGES = [
  "app/[country]/[locale]/(storefront)/account/register/page.tsx",
  "app/[country]/[locale]/(storefront)/account/forgot-password/page.tsx",
  "app/[country]/[locale]/(storefront)/account/reset-password/page.tsx",
  "app/[country]/[locale]/(storefront)/account/(authenticated)/profile/page.tsx",
  "components/account/AccountSignIn.tsx",
];

describe("buyer authentication gate (SPREE-X1)", () => {
  it("ships gated — flipping it to live must be a deliberate, reviewed change", () => {
    expect(ACCOUNT_AUTH_CAPABILITY).toBe("gated");
  });

  it("every auth screen checks the gate and renders the unavailable notice", () => {
    for (const page of ACCOUNT_PAGES) {
      const src = read(page);
      expect(src, page).toContain("ACCOUNT_AUTH_CAPABILITY");
      expect(src, page).toContain("AccountAuthUnavailable");
    }
  });

  it("the session provider never syncs with the server while gated", () => {
    const src = read("contexts/AuthContext.tsx");
    const gate = src.indexOf('ACCOUNT_AUTH_CAPABILITY !== "live"');
    const sync = src.indexOf("await syncSession()");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(sync);
  });

  it("every customer server action checks the gate before touching Spree", () => {
    const src = read("lib/data/customer.ts");
    const spreeAccess =
      /getClient\(|withAuthRefresh\(|ensureFreshSession\(|fetchCustomer\(|finalizeAuth\(/;
    const chunks = src.split(/\nexport async function /).slice(1);
    expect(chunks.length).toBeGreaterThanOrEqual(8);
    for (const chunk of chunks) {
      const name = chunk.slice(0, chunk.indexOf("("));
      const access = chunk.search(spreeAccess);
      if (access === -1) continue;
      const gate = chunk.indexOf("accountAuthLive()");
      expect(gate, `${name} must check accountAuthLive()`).toBeGreaterThan(-1);
      expect(gate, `${name}: gate must precede Spree access`).toBeLessThan(
        access,
      );
    }
  });

  it("buyer-account UI has no runtime Spree import", () => {
    const files = [
      ...walk(join(SRC, "components", "account")),
      join(SRC, "contexts", "AuthContext.tsx"),
      ...walk(
        join(SRC, "app", "[country]", "[locale]", "(storefront)", "account"),
      ),
    ];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const rel = relative(SRC, file);
      // Cookie-presence helpers (getAccessToken / getRefreshToken) are fine;
      // the SDK client, session refresh and config are not.
      expect(src, rel).not.toMatch(
        /from\s+["']@\/lib\/spree\/(config|auth-helpers)/,
      );
      expect(src, rel).not.toMatch(
        /\b(getClient|getClientForSurface|withAuthRefresh|ensureFreshSession|initSpreeNext)\b/,
      );
      // type-only SDK imports (dead legacy views) are tolerated; values are not
      expect(src, rel).not.toMatch(
        /import\s+(?!type\b)[^;]*from\s+["']@spree\//,
      );
    }
  });

  it("no action returns an upstream message (no `error:` text field)", () => {
    const src = read("lib/data/customer.ts");
    expect(src).not.toMatch(/error\??:\s*string/);
    expect(src).not.toMatch(/error\.message/);
    expect(src).not.toContain("buyerSafeMessage");
  });

  it("the shopper-facing copy never mentions Spree or its environment", () => {
    for (const locale of ["ar", "en", "de", "es", "fr", "pl"]) {
      const messages = JSON.parse(
        readFileSync(join(SRC, "..", "messages", `${locale}.json`), "utf8"),
      ) as {
        accountGate: Record<string, string>;
        accountErrors: Record<string, string>;
      };
      expect(
        JSON.stringify([messages.accountGate, messages.accountErrors]),
        locale,
      ).not.toMatch(/spree|SPREE_|environment|configured/i);
    }
    const notice = read("components/account/AccountAuthUnavailable.tsx");
    expect(notice).not.toMatch(/SPREE_|process\.env/);
  });
});
