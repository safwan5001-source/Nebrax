import { Badge } from '@/components/ui/badge';

type Tone = 'neutral' | 'muted' | 'positive' | 'warning' | 'negative';

/** Membership status → tone. Text always accompanies the colour (status is never colour-only). */
export const MEMBERSHIP_STATUS_TONE: Record<string, Tone> = {
  pending: 'warning',
  approved: 'positive',
  rejected: 'negative',
  suspended: 'muted',
};

export function toneFor(map: Record<string, Tone>, value: string | null | undefined): Tone {
  return (value && map[value]) || 'muted';
}

export function StatusBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <Badge tone={tone}>{children}</Badge>;
}
