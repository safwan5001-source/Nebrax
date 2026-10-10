// Bundle once, render many frames — used for frame-by-frame review of cuts and morphs.
// usage: node scripts/stills.mjs 0 40 90 ...   (outputs out/stills/f####.jpg)
import path from 'node:path';
import fs from 'node:fs';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';

const frames = process.argv.slice(2).map(Number);
const browserExecutable = process.env.AWJ_CHROME || null;
const serveUrl = await bundle({ entryPoint: path.resolve('src/index.ts') });
const composition = await selectComposition({ serveUrl, id: 'AwjCommercial', browserExecutable });
fs.mkdirSync('out/stills', { recursive: true });
for (const frame of frames) {
  const output = `out/stills/f${String(frame).padStart(4, '0')}.jpg`;
  await renderStill({ serveUrl, composition, frame, output, imageFormat: 'jpeg', jpegQuality: 85, browserExecutable });
  console.log(output);
}
