import { describe, expect, it } from 'vitest';
import {
  getDocumentImagePdfOpacity,
  getDocumentImagePdfSize,
  getDocumentImagePdfX,
  getDocumentImagePreviewClass,
  getDocumentImagePreviewOpacityClass,
  withDocumentImagePdfOpacity,
} from './block-image-size';

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

  it('preserves the historical opacity of legacy stamp and signature revisions', () => {
    expect(getDocumentImagePreviewOpacityClass('stamp')).toBe('opacity-90');
    expect(getDocumentImagePreviewOpacityClass('signature')).toBe('opacity-100');
    expect(getDocumentImagePdfOpacity('stamp')).toBe(0.9);
    expect(getDocumentImagePdfOpacity('signature')).toBe(1);
  });

  it('maps constrained opacity levels consistently for previews and PDFs', () => {
    expect(getDocumentImagePreviewOpacityClass('stamp', 'solid')).toBe('opacity-100');
    expect(getDocumentImagePreviewOpacityClass('stamp', 'soft')).toBe('opacity-75');
    expect(getDocumentImagePreviewOpacityClass('signature', 'faint')).toBe('opacity-50');
    expect(getDocumentImagePdfOpacity('stamp', 'solid')).toBe(1);
    expect(getDocumentImagePdfOpacity('stamp', 'soft')).toBe(0.75);
    expect(getDocumentImagePdfOpacity('signature', 'faint')).toBe(0.5);
  });

  it('isolates PDF opacity and restores the full graphics state after drawing', () => {
    const states: number[] = [];
    const pdf = {
      GState: (parameters: { opacity: number }) => ({ opacity: parameters.opacity }),
      setGState: (state: unknown) => states.push((state as { opacity: number }).opacity),
    };
    let drawn = false;

    withDocumentImagePdfOpacity(pdf, 0.75, () => { drawn = true; });

    expect(drawn).toBe(true);
    expect(states).toEqual([0.75, 1]);
  });

  it('restores the full graphics state if drawing the image fails', () => {
    const states: number[] = [];
    const pdf = {
      GState: (parameters: { opacity: number }) => ({ opacity: parameters.opacity }),
      setGState: (state: unknown) => states.push((state as { opacity: number }).opacity),
    };

    expect(() => withDocumentImagePdfOpacity(pdf, 0.5, () => { throw new Error('image draw failed'); })).toThrow('image draw failed');
    expect(states).toEqual([0.5, 1]);
  });

  it('maps logical image alignment to the RTL PDF page without changing the default start edge', () => {
    expect(getDocumentImagePdfX(undefined, 210, 10, 200, 32)).toBe(168);
    expect(getDocumentImagePdfX('start', 210, 10, 200, 32)).toBe(168);
    expect(getDocumentImagePdfX('center', 210, 10, 200, 32)).toBe(89);
    expect(getDocumentImagePdfX('end', 210, 10, 200, 32)).toBe(10);
  });
});
