import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const files = readdirSync(__dirname).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const source = (f: string) => strip(readFileSync(join(__dirname, f), 'utf8'));

describe('مساحة الاستقبال: حدود معمارية (COPS-H3-5)', () => {
  it('لا كتابة HTTP مباشرة في الوحدة: كل الكتابات تمرّ بملفات orders/alerts المعتمدة', () => {
    for (const f of files) expect(/method:\s*['"](POST|PUT|PATCH|DELETE)/i.test(source(f)), f).toBe(false);
  });

  it('لا نظام تنبيه موازٍ: لا محرّك ولا منسّق ولا صوت ولا جلب لـ feed/attention/config', () => {
    for (const f of files) {
      const src = source(f);
      expect(/new AlertEngine|new TabCoordinator|new SilencedStore|new Audio\(|AudioContext/.test(src), f).toBe(false);
      expect(/alerts-api|commerce\/orders\/(feed|attention)|alerts\/config/.test(src), f).toBe(false);
    }
  });

  it('لا استطلاع خاص باللوحة: لا مؤقّت دوري في الجلب، والمؤقّت الوحيد في العرض يحدّث الساعة فقط', () => {
    expect(/setInterval/.test(source('use-reception-board.ts'))).toBe(false);
    expect(/setInterval/.test(source('reception-api.ts'))).toBe(false);
    const board = source('reception-board.tsx');
    expect((board.match(/setInterval/g) ?? []).length).toBe(1);
    expect(board).toMatch(/setInterval\(\(\) => setNow\(Date\.now\(\)\)/);
  });

  it('لا منطق حالة محلي للإجراءات: لوحة الطلب تقرأ العقد من الخادم ولا تقارن حالات', () => {
    const panel = source('reception-order-panel.tsx');
    expect(panel).toMatch(/accept_action\?\.available === true/);
    expect(panel).toMatch(/reject_action\?\.available === true/);
    expect(/operational_status\s*===|fulfillment\??\.status\s*===|\.status\s*===\s*['"]/.test(panel)).toBe(false);
  });
});
