/* @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MobileRecordItem } from './mobile-record';

afterEach(cleanup);

describe('MobileRecordItem caption', () => {
  it('renders the caption directly under the subtitle, in plain (non-Mono) text', () => {
    render(
      <MobileRecordItem
        record={{ title: 'Al Tumooh Trading Co.', subtitle: '0555001122', caption: 'Dammam' }}
      />
    );

    const caption = screen.getByText('Dammam');
    expect(caption.className).not.toContain('num');
  });

  it('keeps reading order: title, then subtitle, then caption', () => {
    const { container } = render(
      <MobileRecordItem
        record={{ title: 'Al Tumooh Trading Co.', subtitle: '0555001122', caption: 'Dammam' }}
      />
    );

    const text = container.textContent ?? '';
    expect(text.indexOf('Al Tumooh Trading Co.')).toBeLessThan(text.indexOf('0555001122'));
    expect(text.indexOf('0555001122')).toBeLessThan(text.indexOf('Dammam'));
  });

  it('omits the caption line entirely when not provided, unchanged from before this field existed', () => {
    const { container } = render(
      <MobileRecordItem record={{ title: 'Al Tumooh Trading Co.', subtitle: '0555001122' }} />
    );

    // سطران فقط: العنوان الأساسي والطرف المقابل — لا خانة فارغة لِـ caption.
    expect(container.querySelectorAll('.min-w-0.flex-1 > div').length).toBe(2);
  });
});
