/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DetailPage, DetailSummary } from './detail-page';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('lucide-react', () => {
  const iconStub = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) =>
      typeof name === 'symbol' || name === 'then' || name === '__esModule'
        ? Reflect.get(target, name)
        : iconStub,
    has: () => true,
  });
});

afterEach(cleanup);

const sections = [
  { id: 'details', title: 'Details', content: <p>detail body</p> },
  { id: 'allocations', title: 'Allocations', count: 2, content: <p>allocation body</p> },
];

function renderDetail(props: Partial<React.ComponentProps<typeof DetailPage>> = {}) {
  return render(
    <DetailPage
      backHref="/receipt-vouchers"
      backLabel="Back to vouchers"
      title="RV-2026-0001"
      sections={sections}
      {...props}
    />
  );
}

/** الأقسام تظهر مرّتين (أكورديون الجوال + بطاقات الديسكتوب) في jsdom معاً. */
function accordion(container: HTMLElement) {
  return container.querySelector('.lg\\:hidden') as HTMLElement;
}

describe('DetailPage header', () => {
  it('leads with the document number and its status badges', () => {
    renderDetail({ badges: <span>Posted</span> });

    const heading = screen.getByRole('heading', { name: 'RV-2026-0001' });
    expect(heading.className).toContain('num');
    expect(screen.getByText('Posted')).toBeTruthy();
  });

  it('offers a labelled way back to the list', () => {
    renderDetail();

    expect(screen.getByRole('link', { name: 'Back to vouchers' }).getAttribute('href'))
      .toBe('/receipt-vouchers');
  });

  it('renders the meta line and the alert slot when supplied', () => {
    renderDetail({ meta: 'Journal entry created', alert: <p role="alert">Could not post</p> });

    expect(screen.getByText('Journal entry created')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Could not post');
  });

  it('renders declared actions and fires their handlers', async () => {
    const onPost = vi.fn();
    renderDetail({ actions: [{ key: 'post', label: 'Post', onClick: onPost, variant: 'primary' }] });

    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(onPost).toHaveBeenCalledOnce();
  });

  it('respects a disabled action instead of firing it', async () => {
    const onDelete = vi.fn();
    renderDetail({
      actions: [{ key: 'delete', label: 'Delete', onClick: onDelete, variant: 'danger', disabled: true }],
    });

    const button = screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await userEvent.click(button);
    expect(onDelete).not.toHaveBeenCalled();
  });
});

describe('DetailPage responsive body', () => {
  it('opens the first section on mobile and keeps the others closed', () => {
    const { container } = renderDetail();

    const items = within(accordion(container)).getAllByRole('button');
    expect(items[0].getAttribute('aria-expanded')).toBe('true');
    expect(items[1].getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps exactly one section open — opening a second closes the first', async () => {
    const { container } = renderDetail();
    const items = within(accordion(container)).getAllByRole('button');

    await userEvent.click(items[1]);
    expect(items[0].getAttribute('aria-expanded')).toBe('false');
    expect(items[1].getAttribute('aria-expanded')).toBe('true');
  });

  it('collapses the open section when its own header is clicked again', async () => {
    const { container } = renderDetail();
    const items = within(accordion(container)).getAllByRole('button');

    await userEvent.click(items[0]);
    expect(items[0].getAttribute('aria-expanded')).toBe('false');
  });

  it('shows a section count beside its title', () => {
    const { container } = renderDetail();

    expect(within(accordion(container)).getByText('2')).toBeTruthy();
  });

  it('places the summary in the sticky aside on desktop and as a section on mobile', () => {
    const { container } = renderDetail({ summary: <p>summary body</p>, summaryTitle: 'Financial summary' });

    // مرّة في الأكورديون ومرّة في العمود اللاصق — لا مرّة واحدة ولا ثلاث.
    expect(screen.getAllByText('Financial summary')).toHaveLength(2);
    expect(container.querySelector('.lg\\:sticky')).toBeTruthy();
  });

  it('drops the aside column entirely when there is no summary', () => {
    const { container } = renderDetail();

    expect(container.querySelector('.lg\\:sticky')).toBeNull();
  });

  it('pads normal section content but lets a flush section reach the edges', () => {
    const { container } = renderDetail({
      sections: [{ id: 'lines', title: 'Lines', content: <p>table</p>, flush: true }],
    });

    const body = within(accordion(container)).getByText('table').parentElement as HTMLElement;
    expect(body.className).not.toContain('p-4');
  });

  it('renders free children below the sections', () => {
    renderDetail({ children: <p>reversal card</p> });

    expect(screen.getByText('reversal card')).toBeTruthy();
  });
});

describe('DetailSummary', () => {
  it('renders money values in Mono, aligned to the logical end', () => {
    render(<DetailSummary rows={[{ label: 'Amount', value: '1,150.00' }]} />);

    const value = screen.getByText('1,150.00');
    expect(value.className).toContain('num');
    expect(value.className).toContain('text-end');
  });

  it('sets the strong row apart as the decisive total', () => {
    render(
      <DetailSummary
        rows={[
          { label: 'Subtotal', value: '1,000.00' },
          { label: 'Total', value: '1,150.00', strong: true },
        ]}
      />
    );

    expect(screen.getByText('1,150.00').className).toContain('font-bold');
    expect(screen.getByText('1,000.00').className).not.toContain('font-bold');
  });

  it('shows the accounting note under the figures when given', () => {
    render(<DetailSummary rows={[]} note="Posted documents cannot be edited" />);

    expect(screen.getByText('Posted documents cannot be edited')).toBeTruthy();
  });
});
