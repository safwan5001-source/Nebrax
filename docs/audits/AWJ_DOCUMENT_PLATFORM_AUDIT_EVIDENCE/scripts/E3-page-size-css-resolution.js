// Experiment 3: how Chromium resolves the exact @page strings the app injects (printDocument) on top of the global A4 rule
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
function info(f) {
  const i = execSync(`pdfinfo "${f}"`).toString();
  return { pages: /Pages:\s+(\d+)/.exec(i)?.[1], size: /Page size:\s+(.*)/.exec(i)?.[1] };
}
const GLOBAL = '@media print { @page { size: A4; margin: 14mm; } }';
const variants = {
  // exactly what printDocument injects for thermal (heightMm = 0)
  'thermal80_injected_auto': '@media print { @page { size: 80mm auto; margin: 4mm; } }',
  'thermal58_injected_auto': '@media print { @page { size: 58mm auto; margin: 4mm; } }',
  // what it injects for a4 / letter / legal when paper given
  'a4_injected': '@media print { @page { size: 210mm 297mm; } }',
  'letter_injected': '@media print { @page { size: 216mm 279mm; } }',
  // hypothetical A5/A6 for evidence only
  'a5_hypothetical': '@media print { @page { size: 148mm 210mm; } }',
  'a6_hypothetical': '@media print { @page { size: 105mm 148mm; } }',
  'no_injection': '',
};
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  for (const [name, css] of Object.entries(variants)) {
    const page = await browser.newPage();
    const body = Array.from({ length: 60 }, (_, i) => `<div style="border-bottom:1px dashed #999;padding:2px">سطر ${i + 1} — Line item ${i + 1} ........ 12.50</div>`).join('');
    await page.setContent(`<html><head><style>${GLOBAL}${css}</style></head><body><div id="r" style="width:80mm;font:11px sans-serif">${body}</div></body></html>`);
    await page.emulateMedia({ media: 'print' });
    const f = path.join(OUT, `css_${name}.pdf`);
    await page.pdf({ path: f, preferCSSPageSize: true, printBackground: true });
    console.log(name.padEnd(28), JSON.stringify(info(f)));
    await page.close();
  }
  await browser.close();
})();
