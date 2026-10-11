import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePresentationConfig } from "../config";
import { ICON_KEYS } from "../icon-registry";
import { mainMenu, normalizeNavigation } from "../navigation";

const root = resolve(__dirname, "../../../../../");
const fixture = JSON.parse(
  readFileSync(
    resolve(root, "tests/Fixtures/presentation/navigation.json"),
    "utf8",
  ),
) as { cases: Array<{ name: string; input: unknown; expected: unknown }> };

describe("navigation — shared fixture (V7d-2)", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(normalizeNavigation(c.input) ?? null).toEqual(c.expected);
      const config = normalizePresentationConfig({ navigation: c.input });
      if (c.expected === null) expect("navigation" in config).toBe(false);
      else expect(config.navigation).toEqual(c.expected);
    });
  }
});

describe("navigation — integration (V7d-2)", () => {
  it("absent navigation ⇒ no key and the version stays 3", () => {
    const plain = normalizePresentationConfig({});
    expect("navigation" in plain).toBe(false);
    expect(plain.version).toBe(3);
  });

  it("the legacy header.links survive beside a navigation document", () => {
    const config = normalizePresentationConfig({
      navigation: {
        menus: [
          {
            id: "main",
            items: [{ id: "a", label: "A", target: { kind: "home" } }],
          },
        ],
      },
    });
    expect(config.header.links.length).toBeGreaterThan(0);
    expect(mainMenu(config.navigation)?.items[0]?.id).toBe("a");
  });

  it("mainMenu is undefined when there is no main menu", () => {
    expect(mainMenu(undefined)).toBeUndefined();
    expect(
      mainMenu(
        normalizeNavigation({
          menus: [
            {
              id: "footer",
              items: [{ id: "a", label: "A", target: { kind: "home" } }],
            },
          ],
        }),
      ),
    ).toBeUndefined();
  });

  it("the PHP icon registry lists exactly the TS keys, in order", () => {
    const php = readFileSync(
      resolve(root, "app/Support/Commerce/IconRegistry.php"),
      "utf8",
    );
    const keys = [...php.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
    expect(keys).toEqual([...ICON_KEYS]);
  });
});
