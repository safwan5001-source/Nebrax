/**
 * Demo transaction. Fictional business, fictional figures — never production data.
 * All money in halalas (minor units, integers) exactly like the AWJ ledger, formatted
 * only at the display layer. Every figure below reconciles:
 *
 *   4 × 271.74 = 1,086.96  ·  VAT 15% = 163.04  ·  total 1,250.00
 *   cost: 4 × 180.00 (moving average) = 720.00
 *   KPI deltas: sales +1,250.00 · cash +1,250.00 · stock value −720.00
 */
export const SALE = {
  store: 'مركز الخليج لخدمات السيارات',
  vatNo: '310123456700003',
  invoice: 'INV-2026-00418',
  journalSale: 'JE-2026-01872',
  journalCost: 'JE-2026-01873',
  date: '2026-09-29',
  time: '10:42',
  product: 'زيت محرك 5W-30',
  pack: '4 لتر',
  sku: 'OIL-5W30-4L',
  qty: 4,
  unitNet: 27174, // halalas, excl. VAT
  unitGross: 31250, // halalas, incl. VAT (shelf price)
  subtotal: 108696,
  vat: 16304,
  total: 125000,
  unitCost: 18000,
  cost: 72000,
  stockBefore: 128,
  stockAfter: 124,
} as const;

/** Running cart totals as the cashier taps the tile: qty 1..4 (halalas). */
export const CART_STEPS = [31250, 62500, 93750, 125000] as const;

export const KPI = {
  salesToday: [4758000, 4883000],
  cash: [21784000, 21909000],
  receivables: [6320000, 6320000],
  stockValue: [6518000, 6446000],
} as const;

/** Cumulative sales today (halalas) at 06:00, 07:00 … 10:00, 10:42. The film's sale lands on the last point. */
export const SALES_CURVE = [0, 312000, 1157000, 2435000, 4537000, 4758000];
export const SALES_HOURS = [0, 1, 2, 3, 4, 4.7];

export const fmt = (halalas: number): string => {
  const neg = halalas < 0;
  const abs = Math.abs(Math.round(halalas));
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = (abs % 100).toString().padStart(2, '0');
  return `${neg ? '−' : ''}${whole}.${frac}`;
};
