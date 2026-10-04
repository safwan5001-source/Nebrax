// H4-8 integrated QA helpers — drives the REAL web app (:3000) against the REAL Laravel (:8000).
import { chromium } from '/home/user/Nebrax/web/node_modules/playwright/index.mjs';
import fs from 'node:fs';
export const SEED = JSON.parse(fs.readFileSync(process.env.H48_SEED ?? './seed.json', 'utf8'));
export const WEB = 'http://127.0.0.1:3000';
export const API = 'http://127.0.0.1:8000';
export const OUT = process.env.H48_OUT ?? './out';
fs.mkdirSync(OUT, { recursive: true });
export async function browser(extraArgs = []) {
  return chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', ...extraArgs] });
}
export async function login(page, locale = 'ar') {
  await page.goto(`${WEB}/login`);
  await page.locator('input[type="email"]').fill(SEED.email);
  await page.locator('input[type="password"]').fill(SEED.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
}
export const log = (...a) => console.log(...a);
