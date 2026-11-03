import { describe, expect, it } from 'vitest';
import { SILENCE_TTL_MS, SilencedStore, cursorStore, type SilenceStorage } from './silenced-store';

const mem = (): SilenceStorage & { raw: Map<string, string> } => {
  const raw = new Map<string, string>();

  return { raw, getItem: (k) => raw.get(k) ?? null, setItem: (k, v) => void raw.set(k, v) };
};

describe('SilencedStore / cursorStore', () => {
  it('يضيف ويقرأ ويشترك بين النسخ على التخزين نفسه ويفصل بالنطاق', () => {
    const storage = mem();
    const a = new SilencedStore(storage, 't1:u1');
    a.add(['o1', 'o2']);
    expect([...new SilencedStore(storage, 't1:u1').ids()].sort()).toEqual(['o1', 'o2']);
    expect(new SilencedStore(storage, 't1:u2').ids().size).toBe(0);
    expect(new SilencedStore(storage, 't2:u1').ids().size).toBe(0);
  });

  it('ينظّف ما تجاوز 48 ساعة ويتحمل تخزيناً تالفاً أو غائباً', () => {
    const storage = mem();
    let t = 0;
    const s = new SilencedStore(storage, 's', () => t);
    s.add(['old']);
    t = SILENCE_TTL_MS + 1;
    s.add(['fresh']);
    expect([...s.ids()]).toEqual(['fresh']);

    storage.raw.set('awj:commerce-alerts:silenced:bad', '{not json');
    expect(new SilencedStore(storage, 'bad').ids().size).toBe(0);
    expect(new SilencedStore(null, 'x').ids().size).toBe(0);
    new SilencedStore(null, 'x').add(['a']); // لا يرمي
  });

  it('المؤشّر: يحفظ ويقرأ أعداداً صحيحة فقط، والغياب/التالف ⇒ null (الرأس)', () => {
    const storage = mem();
    const c = cursorStore(storage, 's');
    expect(c.load()).toBeNull();
    c.save(77);
    expect(c.load()).toBe(77);
    storage.setItem('awj:commerce-alerts:cursor:s', 'abc');
    expect(c.load()).toBeNull();
    storage.setItem('awj:commerce-alerts:cursor:s', '-4');
    expect(c.load()).toBeNull();
    expect(cursorStore(null, 's').load()).toBeNull();
    cursorStore(null, 's').save(1); // لا يرمي
  });
});
