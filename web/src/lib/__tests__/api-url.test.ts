import { describe, expect, it } from 'vitest';
import { resolveApiUrl } from '@/lib/api';

describe('resolveApiUrl', () => {
  it('joins ordinary API-relative paths', () => {
    expect(resolveApiUrl('/products/pr2/media', 'https://api.example.com/api'))
      .toBe('https://api.example.com/api/products/pr2/media');
  });

  it('does not duplicate an API prefix returned by the server', () => {
    expect(resolveApiUrl('/api/products/pr2/media/m1/download', 'https://api.example.com/api/'))
      .toBe('https://api.example.com/api/products/pr2/media/m1/download');
  });

  it('removes copied whitespace before deciding whether the API prefix exists', () => {
    expect(resolveApiUrl('/api/products/pr2/media/m1/download', 'https://api.example.com/api\n\n'))
      .toBe('https://api.example.com/api/products/pr2/media/m1/download');
  });

  it('keeps absolute download URLs unchanged', () => {
    expect(resolveApiUrl('https://cdn.example.com/product.jpg', 'https://api.example.com/api'))
      .toBe('https://cdn.example.com/product.jpg');
  });
});
