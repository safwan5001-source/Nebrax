import { formatPayAmount } from '@/lib/pay-link';

/** فرق موقَّع بإشارة صريحة (+ / −) كي لا تضيع الجهة. */
export function formatSigned(minor: number, currency: string): string {
  const text = formatPayAmount(Math.abs(minor), currency);
  return minor > 0 ? `+${text}` : minor < 0 ? `−${text}` : text;
}
