import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const storefrontRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(storefrontRoot, "../web/public/payment-brands");
const targetRoot = resolve(storefrontRoot, "public/payment-brands");
const files = ["mada.svg", "visa.svg", "mastercard.svg", "apple-pay.svg"];

await mkdir(targetRoot, { recursive: true });
for (const file of files) {
  await copyFile(resolve(sourceRoot, file), resolve(targetRoot, file));
}

console.log(`Synced ${files.length} payment brand assets from web/public/payment-brands.`);
