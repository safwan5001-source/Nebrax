import { describe, it, expect } from 'vitest';
import { toCsv } from '../export';

describe('toCsv — تسلسل CSV متوافق مع Excel', () => {
  it('يبدأ بـ BOM ويفصل بـ CRLF', () => {
    const csv = toCsv(['a', 'b'], [[1, 2]]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toBe('\uFEFFa,b\r\n1,2');
  });

  it('يهرّب الفواصل والاقتباس والأسطر', () => {
    const csv = toCsv(['name', 'note'], [['الواحة, للتجارة', 'يقول "مرحباً"'], ['سطر\nثانٍ', 'ok']]);
    const lines = csv.replace('\uFEFF', '').split('\r\n');
    expect(lines[0]).toBe('name,note');
    expect(lines[1]).toBe('"الواحة, للتجارة","يقول ""مرحباً"""');
    expect(lines[2]).toBe('"سطر\nثانٍ",ok');
  });

  it('يتعامل مع null/undefined كخلية فارغة', () => {
    expect(toCsv(['x', 'y'], [[null, undefined]])).toBe('\uFEFFx,y\r\n,');
  });
});
