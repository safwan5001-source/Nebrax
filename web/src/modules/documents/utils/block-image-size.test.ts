import { describe, expect, it } from 'vitest';
import { getDocumentImagePdfSize, getDocumentImagePdfX, getDocumentImagePreviewClass } from './block-image-size';

describe('خصائص حجم صور الكتل', () => {
  it('keeps the historical medium size when a stored revision has no image size', () => {
    expect(getDocumentImagePreviewClass('stamp')).toBe(getDocumentImagePreviewClass('stamp', 'md'));
    expect(getDocumentImagePreviewClass('signature')).toBe(getDocumentImagePreviewClass('signature', 'md'));
    expect(getDocumentImagePdfSize(undefined, 32, 24)).toEqual({ width: 32, height: 24 });
  });

  it('scales stamp and signature images through the constrained size values', () => {
    expect(getDocumentImagePreviewClass('stamp', 'lg')).toContain('h-32');
    expect(getDocumentImagePreviewClass('signature', 'sm')).toContain('h-10');
    expect(getDocumentImagePdfSize('sm', 32, 24)).toEqual({ width: 24, height: 18 });
    expect(getDocumentImagePdfSize('lg', 32, 24)).toEqual({ width: 40, height: 30 });
  });

  it('maps logical image alignment to the RTL PDF page without changing the default start edge', () => {
    expect(getDocumentImagePdfX(undefined, 210, 10, 200, 32)).toBe(168);
    expect(getDocumentImagePdfX('start', 210, 10, 200, 32)).toBe(168);
    expect(getDocumentImagePdfX('center', 210, 10, 200, 32)).toBe(89);
    expect(getDocumentImagePdfX('end', 210, 10, 200, 32)).toBe(10);
  });
});
