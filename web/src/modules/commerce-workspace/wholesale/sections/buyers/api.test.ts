import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import {
  DECISION_NOTE_MAX,
  MEMBERSHIP_ACTIONS,
  MEMBERSHIP_STATUSES,
  actionsFor,
  buildMembershipsQuery,
  fetchMembershipCounts,
  fetchMemberships,
  membershipsPath,
  transitionMembership,
} from './api';

describe('membership transitions offered per status', () => {
  it('mirrors WholesaleMembershipService::TRANSITIONS', () => {
    expect(actionsFor('pending')).toEqual(['approve', 'reject']);
    expect(actionsFor('approved')).toEqual(['suspend']);
    expect(actionsFor('suspended')).toEqual(['reinstate']);
    expect(actionsFor('rejected')).toEqual([]);
    expect(actionsFor('something_new')).toEqual([]);
  });

  it('never offers a transition that does not exist', () => {
    for (const status of MEMBERSHIP_STATUSES) for (const action of actionsFor(status)) expect(MEMBERSHIP_ACTIONS).toContain(action);
  });
});

describe('membership client', () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it('builds a whitelisted, bounded query', () => {
    expect(buildMembershipsQuery({ status: 'pending', page: 3, perPage: 50 }).toString()).toBe('status=pending&page=3&per_page=50');
    expect(buildMembershipsQuery({ status: '', page: 1 }).toString()).toBe('per_page=25');
    expect(buildMembershipsQuery({ status: 'bogus' as never, perPage: 9999 }).toString()).toBe('per_page=100');
  });

  it('lists a channel without sending any tenant', async () => {
    apiMock.mockResolvedValue({ data: [], meta: { page: 1, per_page: 25, total: 0, last_page: 1 } });
    await fetchMemberships('c 1', { status: 'approved' });
    expect(apiMock).toHaveBeenCalledWith('/commerce/wholesale/channels/c%201/memberships?status=approved&per_page=25');
    expect(membershipsPath('c1')).toBe('/commerce/wholesale/channels/c1/memberships');
    expect(JSON.stringify(apiMock.mock.calls)).not.toContain('tenant');
  });

  it('counts every status from the real server totals (per_page=1)', async () => {
    apiMock.mockImplementation((path: string) => {
      const status = new URL(path, 'http://x').searchParams.get('status');
      const total = { pending: 4, approved: 9, rejected: 1, suspended: 2 }[status as string] ?? -1;
      return Promise.resolve({ data: [], meta: { page: 1, per_page: 1, total, last_page: total } });
    });
    await expect(fetchMembershipCounts('c1')).resolves.toEqual({ pending: 4, approved: 9, rejected: 1, suspended: 2 });
    for (const call of apiMock.mock.calls) expect(String(call[0])).toContain('per_page=1');
  });

  it('posts a decision with a trimmed, capped note and no tenant', async () => {
    apiMock.mockResolvedValue({ data: { id: 'm1' } });
    await transitionMembership('m 1', 'approve', `  ${'x'.repeat(DECISION_NOTE_MAX + 20)}  `);
    const [path, options] = apiMock.mock.calls[0];
    expect(path).toBe('/commerce/wholesale/memberships/m%201/approve');
    expect(options.method).toBe('POST');
    expect(options.body.note).toHaveLength(DECISION_NOTE_MAX);
    await transitionMembership('m1', 'suspend');
    expect(apiMock.mock.calls[1][1].body).toEqual({});
    expect(JSON.stringify(apiMock.mock.calls)).not.toContain('tenant');
  });
});
