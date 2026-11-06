import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, MAX_PER_DELIVERY, MAX_PER_REQUEST, allowedMime, checkFiles, formatBytes, isImageMime, prepareImage } from './attachments';

const file = (name: string, type: string, size = 100) => new File([new Uint8Array(size)], name, { type });

describe('supplier-note file checks (UX only — the server judges the real content)', () => {
  it('accepts exactly PDF, JPG and PNG', () => {
    const { accepted, rejected } = checkFiles([file('a.pdf', 'application/pdf'), file('b.jpg', 'image/jpeg'), file('c.png', 'image/png')], 0);
    expect(accepted).toHaveLength(3);
    expect(rejected).toEqual([]);
  });

  it('rejects SVG, HTML, executables, Office files, WebP and HEIC with a type reason', () => {
    for (const [name, type] of [['x.svg', 'image/svg+xml'], ['x.html', 'text/html'], ['x.exe', 'application/x-msdownload'], ['x.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], ['x.webp', 'image/webp'], ['x.heic', 'image/heic']] as const) {
      expect(checkFiles([file(name, type)], 0).rejected).toEqual([{ name, reason: 'type' }]);
    }
  });

  it('falls back to the extension only when the browser gives no type, and never trusts a lying extension over a real type', () => {
    expect(allowedMime({ name: 'scan.PDF', type: '' })).toBe('application/pdf');
    expect(allowedMime({ name: 'photo.jpeg', type: 'application/octet-stream' })).toBe('image/jpeg');
    expect(allowedMime({ name: 'evil.pdf', type: 'text/html' })).toBeNull();
    expect(allowedMime({ name: 'noext', type: '' })).toBeNull();
  });

  it('rejects empty and oversize files and enforces the per-request and per-receiving limits', () => {
    expect(checkFiles([file('e.pdf', 'application/pdf', 0)], 0).rejected[0].reason).toBe('empty');
    expect(checkFiles([file('big.pdf', 'application/pdf', MAX_FILE_BYTES + 1)], 0).rejected[0].reason).toBe('size');
    expect(checkFiles([file('ok.pdf', 'application/pdf', MAX_FILE_BYTES)], 0).accepted).toHaveLength(1);
    const many = Array.from({ length: MAX_PER_REQUEST + 2 }, (_, i) => file(`f${i}.pdf`, 'application/pdf'));
    const result = checkFiles(many, 0);
    expect(result.accepted).toHaveLength(MAX_PER_REQUEST);
    expect(result.rejected.every((item) => item.reason === 'limit')).toBe(true);
    expect(checkFiles([file('x.pdf', 'application/pdf')], MAX_PER_DELIVERY).rejected[0].reason).toBe('limit');
  });

  it('formats sizes and recognises images', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(isImageMime('image/png')).toBe(true);
    expect(isImageMime('application/pdf')).toBe(false);
  });

  it('prepareImage leaves PDFs and small images untouched and never throws without canvas support', async () => {
    const pdf = file('a.pdf', 'application/pdf', 5 * 1024 * 1024);
    expect(await prepareImage(pdf)).toBe(pdf);
    const small = file('a.jpg', 'image/jpeg', 1024);
    expect(await prepareImage(small)).toBe(small);
    const big = file('big.jpg', 'image/jpeg', 4 * 1024 * 1024);
    expect(await prepareImage(big)).toBe(big); // لا createImageBitmap في بيئة الاختبار ⇒ الأصل
  });
});
