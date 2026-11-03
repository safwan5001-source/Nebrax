import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_SNAPSHOT, type AlertSnapshot } from './contract';
import { FakeLocks, createChannelHub, flush } from './test-fakes';
import { createLeaseLocks } from './lease-locks';
import { TabCoordinator, type PresenceState } from './tab-coordinator';

interface Tab {
  id: string;
  presence: PresenceState;
  coordinator: TabCoordinator;
  roles: string[];
  snapshots: AlertSnapshot[];
  silenced: string[][];
}

function world() {
  const locks = new FakeLocks();
  const channel = createChannelHub();
  const clock = { t: 1_000_000 };
  const tabs: Tab[] = [];

  const open = (id: string, presence: Partial<PresenceState> = {}): Tab => {
    const tab: Tab = { id, presence: { visible: true, armed: false, interactedAt: 0, ...presence }, coordinator: null as never, roles: [], snapshots: [], silenced: [] };
    tab.coordinator = new TabCoordinator({
      scope: 't1:u1',
      tabId: id,
      locks,
      createChannel: channel,
      getPresence: () => tab.presence,
      now: () => clock.t,
      setInterval: () => 0,
      clearInterval: () => {},
    });
    tab.coordinator.onRole((r) => tab.roles.push(r));
    tab.coordinator.onSnapshot((s) => tab.snapshots.push(s));
    tab.coordinator.onSilence((ids) => tab.silenced.push(ids));
    tabs.push(tab);
    tab.coordinator.start();

    return tab;
  };
  const change = async (tab: Tab, p: Partial<PresenceState>) => {
    tab.presence = { ...tab.presence, ...p };
    tab.coordinator.presenceChanged();
    await flush();
  };

  return { open, change, clock, tabs };
}

const snap = (n: number): AlertSnapshot => ({ ...EMPTY_SNAPSHOT, connection: 'live', total: n });

describe('TabCoordinator (COPS-H3-3, ADR-30 §3)', () => {
  it('قائد واحد فقط من بين عدة تبويبات، والباقون متابعون', async () => {
    const w = world();
    const a = w.open('a');
    const b = w.open('b');
    const c = w.open('c');
    await flush();

    const leaders = w.tabs.filter((t) => t.coordinator.currentRole === 'leader');
    expect(leaders).toHaveLength(1);
    expect(leaders[0].id).toBe('a'); // الأول طلباً (FIFO)
    expect([b, c].every((t) => t.coordinator.currentRole === 'follower')).toBe(true);
    expect(a.roles).toEqual(['leader']);
  });

  it('إغلاق القائد يحرّر القفل فيتولى أول منتظر', async () => {
    const w = world();
    const a = w.open('a');
    const b = w.open('b');
    const c = w.open('c');
    await flush();

    a.coordinator.stop();
    await flush();
    expect(b.coordinator.currentRole).toBe('leader');
    expect(c.coordinator.currentRole).toBe('follower');
  });

  it('قائد مخفي يتنازل لمتابع مرئي ومُسلَّح ويتولى الأخير الاستطلاع', async () => {
    const w = world();
    const a = w.open('a', { visible: false, armed: false });
    const b = w.open('b', { visible: true, armed: false });
    await flush();
    expect(a.coordinator.currentRole).toBe('leader');

    await w.change(b, { armed: true }); // المستخدم فعّل الصوت في التبويب المرئي
    expect(b.coordinator.currentRole).toBe('leader');
    expect(a.coordinator.currentRole).toBe('follower');
  });

  it('قائد غير مُسلَّح يتنازل لنظير مرئي ومُسلَّح، ولا يتنازل لنظير غير مؤهل (لا تأرجح)', async () => {
    const w = world();
    const a = w.open('a', { visible: true, armed: false });
    const b = w.open('b', { visible: true, armed: false });
    await flush();
    expect(a.coordinator.currentRole).toBe('leader');

    await w.change(b, { visible: false });
    await w.change(a, { armed: false });
    expect(a.coordinator.currentRole).toBe('leader'); // b مخفي: لا مبرر

    await w.change(b, { visible: true, armed: true });
    expect(b.coordinator.currentRole).toBe('leader');
    await w.change(a, { armed: true }); // a صار مؤهلاً أيضاً؛ القائد الحالي b يبقى (لا تنازل لمؤهل)
    expect(b.coordinator.currentRole).toBe('leader');
    expect(a.roles.filter((r) => r === 'leader').length).toBe(1);
  });

  it('حامل الصوت واحد: المرئي المُسلَّح الأحدث تفاعلاً، وقد لا يكون القائد', async () => {
    const w = world();
    const a = w.open('a', { visible: true, armed: true, interactedAt: 10 }); // قائد
    const b = w.open('b', { visible: true, armed: true, interactedAt: 20 });
    await flush();
    await w.change(a, {});
    await w.change(b, {});

    expect(a.coordinator.currentRole).toBe('leader');
    expect(a.coordinator.isSoundOwner()).toBe(false);
    expect(b.coordinator.isSoundOwner()).toBe(true);
    expect([a, b].filter((t) => t.coordinator.isSoundOwner())).toHaveLength(1);
  });

  it('لا حامل صوت إن لم يكن أحد مرئياً ومُسلَّحاً (لا ادعاء تنبيه صوتي)', async () => {
    const w = world();
    const a = w.open('a', { visible: true, armed: false });
    const b = w.open('b', { visible: false, armed: true });
    await flush();
    await w.change(a, {});
    await w.change(b, {});
    expect(a.coordinator.isSoundOwner()).toBe(false);
    expect(b.coordinator.isSoundOwner()).toBe(false);
  });

  it('نبضة نظير منتهية (تبويب مات) لا تُحتسب في اختيار حامل الصوت', async () => {
    const w = world();
    const a = w.open('a', { visible: true, armed: true, interactedAt: 5 });
    const b = w.open('b', { visible: true, armed: true, interactedAt: 50 });
    await flush();
    await w.change(a, {});
    await w.change(b, {});
    expect(a.coordinator.isSoundOwner()).toBe(false);

    w.clock.t += 60_000; // b لم يبثّ منذ دقيقة
    expect(a.coordinator.isSoundOwner()).toBe(true);
  });

  it('القائد يبثّ اللقطة للمتابعين، ويصل الإسكات إلى الجميع، وتبويب جديد يتلقى اللقطة الأخيرة فوراً', async () => {
    const w = world();
    const a = w.open('a');
    const b = w.open('b');
    await flush();

    a.coordinator.publishSnapshot(snap(3));
    expect(b.snapshots.at(-1)?.total).toBe(3);
    expect(a.snapshots).toHaveLength(0); // لا صدى لنفسه

    b.coordinator.broadcastSilence(['o1']);
    expect(a.silenced).toEqual([['o1']]);

    const late = w.open('late');
    await flush();
    expect(late.snapshots.at(-1)?.total).toBe(3);
  });

  it('المتابع لا ينشر لقطته، ولا يستقبل القائد لقطات غيره', async () => {
    const w = world();
    const a = w.open('a');
    const b = w.open('b');
    await flush();

    b.coordinator.publishSnapshot(snap(9)); // متابع: يحفظ محلياً ولا يبثّ
    expect(a.snapshots).toHaveLength(0);
  });

  it('بلا Web Locks ولا قناة: يعمل منفرداً قائداً دون استثناء', async () => {
    const c = new TabCoordinator({ scope: 's', tabId: 'x', locks: null, createChannel: () => null, getPresence: () => ({ visible: true, armed: false, interactedAt: 0 }), setInterval: () => 0, clearInterval: () => {} });
    c.start();
    await flush();
    expect(c.currentRole).toBe('leader');
    c.publishSnapshot(snap(1));
    c.stop();
    expect(c.currentRole).toBe('follower');
  });

  it('stop يوقف الاستماع ويحرّر القفل فلا يبقى قائداً', async () => {
    const w = world();
    const a = w.open('a');
    await flush();
    const spy = vi.fn();
    a.coordinator.onSnapshot(spy);
    a.coordinator.stop();
    await flush();
    expect(a.coordinator.currentRole).toBe('follower');
  });
});


describe('TabCoordinator مع عقد إيجار localStorage (سقوط بلا Web Locks) — تنازل بلا حلقة مجهرية (Codex)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
  afterEach(() => { vi.useRealTimers(); });

  it('قائد مخفي يتنازل لنظير مرئي مُسلَّح فيتولاه خلال ثوانٍ، ولا يعيد المتنازل الإمساك به في حلقة', async () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const channel = createChannelHub();
    const presence: Record<string, PresenceState> = {
      a: { visible: false, armed: false, interactedAt: 0 },
      b: { visible: true, armed: false, interactedAt: 0 },
    };
    const make = (id: string) => {
      const roles: string[] = [];
      const c = new TabCoordinator({ scope: 's', tabId: id, locks: createLeaseLocks(storage, id), createChannel: channel, getPresence: () => presence[id] });
      c.onRole((r) => roles.push(r));
      c.start();

      return { c, roles };
    };
    const a = make('a');
    await vi.advanceTimersByTimeAsync(0);
    const b = make('b');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(a.c.currentRole).toBe('leader');

    presence.b = { visible: true, armed: true, interactedAt: 5 }; // المستخدم فعّل الصوت في b
    b.c.presenceChanged();
    await vi.advanceTimersByTimeAsync(0);
    // لا حلقة مجهرية: بعد التنازل مباشرة لم يُعِد a الإمساك عشرات المرات.
    expect(a.roles.filter((r) => r === 'leader').length).toBeLessThanOrEqual(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(b.c.currentRole).toBe('leader');
    expect(a.c.currentRole).toBe('follower');
    expect(a.roles.filter((r) => r === 'leader').length).toBe(1);

    a.c.stop();
    b.c.stop();
  });
});
