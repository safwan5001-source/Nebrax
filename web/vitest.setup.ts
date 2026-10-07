import { vi } from 'vitest';

/**
 * `next/font/google` resolves through a Next.js-specific SWC/webpack transform
 * at build time; under plain Vitest there is no such transform, so the real
 * package export is not callable the way Next.js's compiled output is. Each
 * font function used anywhere in this app is mocked to the same shape
 * Next.js produces (`variable`/`className`).
 *
 * This is a plain object of named exports, not a Proxy over `get` — a Proxy
 * that answers every property access (including `then` and well-known
 * symbols) makes the mocked module look like a thenable to anything that
 * duck-types it, which silently hangs an `await import(...)` forever instead
 * of failing loudly.
 */
vi.mock('next/font/google', () => {
  const loader = () => ({ variable: '--font-mock', className: 'font-mock' });
  return {
    Geist: loader,
    Cairo: loader,
    Tajawal: loader,
    IBM_Plex_Sans_Arabic: loader,
    IBM_Plex_Mono: loader,
    // CUST-HV V5e-2c — the curated font catalogue (`presentation/fonts.ts`)
    Amiri: loader,
    El_Messiri: loader,
    Inter: loader,
    Lora: loader,
    Noto_Sans_Arabic: loader,
    Readex_Pro: loader,
    Rubik: loader,
  };
});
