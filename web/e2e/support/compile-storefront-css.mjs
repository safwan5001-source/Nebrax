import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Compiles the REAL storefront stylesheet (Tailwind v4, native cascade layers) for the cascade proof. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../storefront');
const require = createRequire(path.join(root, 'package.json'));
const tailwind = require('@tailwindcss/postcss');
const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
const from = path.join(root, 'src/app/globals.css');
const css = readFileSync(from, 'utf8');
const out = await postcss([tailwind({ base: root })]).process(css, { from });
writeFileSync(process.argv[2], out.css);
console.log('bytes', out.css.length);
