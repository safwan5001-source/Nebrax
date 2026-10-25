/**
 * X6 — Spree dependency ratchet: CLI.
 *   tsx scripts/spree-ratchet/check.ts            verify against baseline.json (CI)
 *   tsx scripts/spree-ratchet/check.ts --update   rewrite baseline.json (explicit, local only)
 */
import fs from "node:fs";
import path from "node:path";
import {
  type Baseline,
  CATEGORIES,
  compare,
  formatReport,
  scanProject,
  serializeBaseline,
  toBaseline,
} from "./scan";

const root = process.cwd();
const baselinePath = path.join(root, "scripts/spree-ratchet/baseline.json");
const snap = scanProject(root);

if (process.argv.includes("--update")) {
  if (process.env.CI) {
    console.error(
      "Refusing to rewrite the Spree ratchet baseline in CI. Update it locally and commit the diff.",
    );
    process.exit(1);
  }
  fs.writeFileSync(baselinePath, serializeBaseline(toBaseline(snap)));
  console.log(`Baseline written: ${path.relative(root, baselinePath)}`);
  process.exit(0);
}

if (!fs.existsSync(baselinePath)) {
  console.error(`Missing baseline: ${baselinePath}`);
  process.exit(1);
}
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8")) as Baseline;
const cmp = compare(baseline, snap);
const report = formatReport(cmp);
if (report) (cmp.violations.length ? console.error : console.log)(report);
if (cmp.violations.length) process.exit(1);
console.log(
  `Spree dependency ratchet OK — ${CATEGORIES.map((c) => `${c}=${baseline.categories[c].total}`).join(", ")} (baseline)`,
);
