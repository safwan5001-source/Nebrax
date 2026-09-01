import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(file: string) {
  return readFileSync(resolve(process.cwd(), file), 'utf8');
}

describe('POS session detail workspace', () => {
  it('loads one branch-scoped session and its existing evidence contracts', () => {
    const page = source('src/app/(app)/pos/sessions/[id]/page.tsx');

    expect(page).toContain("api<{ data: Session }>(`/pos-sessions/${id}`)");
    expect(page).toContain('`/pos-sessions/${id}/report`');
    expect(page).toContain('`/pos-sessions/${id}/cash-movements`');
    expect(page).toContain('`/pos-sessions/${id}/events`');
    expect(page).toContain('Promise.all');
  });

  it('keeps accounting figures dense, semantic, and token based', () => {
    const page = source('src/app/(app)/pos/sessions/[id]/page.tsx');

    expect(page).toContain('className="num');
    expect(page).toContain("isNegative(row.difference) && 'text-negative'");
    expect(page).toContain('border-border');
    expect(page).toContain('bg-surface');
    expect(page).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(page).not.toContain('gradient');
    expect(page).not.toContain('shadow-xl');
  });

  it('links the session register to the dedicated workspace', () => {
    const list = source('src/app/(app)/pos/sessions/page.tsx');

    expect(list).toContain('href={`/pos/sessions/${row.original.id}`}');
    expect(list).toContain("t('view_details')");
  });

  it('preserves legacy session facts and does not offer inaccessible evidence', () => {
    const page = source('src/app/(app)/pos/sessions/[id]/page.tsx');

    expect(page).toContain("session.handover_status === 'confirmed'");
    expect(page).toContain("session.shift?.name ?? '—'");
    expect(page).toContain('session.variance_journal_entry_id && canViewAccounts');
    expect(page).toContain("permissions?.includes('accounts.view')");
  });
});
