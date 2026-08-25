/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormActions, FormPage } from './form-page';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

afterEach(cleanup);

function renderPage(props: Partial<React.ComponentProps<typeof FormPage>> = {}) {
  return render(
    <FormPage
      backHref="/expenses"
      backLabel="Back to expenses"
      title="New expense"
      {...props}
    >
      <p>body</p>
    </FormPage>
  );
}

describe('FormPage', () => {
  it('renders the title as the page heading with a labelled way back', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'New expense' })).toBeTruthy();
    const back = screen.getByRole('link', { name: 'Back to expenses' });
    expect(back.getAttribute('href')).toBe('/expenses');
  });

  it('shows the description and status slot when given, and omits them otherwise', () => {
    const { unmount } = renderPage({ description: 'Number is generated on save', status: <span>Draft</span> });
    expect(screen.getByText('Number is generated on save')).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
    unmount();

    renderPage();
    expect(screen.queryByText('Number is generated on save')).toBeNull();
    expect(screen.queryByText('Draft')).toBeNull();
  });

  it('renders the aside beside the body only when one is provided', () => {
    const { container, unmount } = renderPage();
    // بلا عمود جانبي لا شبكة أصلاً — المحتوى يأخذ العرض كاملاً.
    expect(container.querySelector('.lg\\:grid-cols-\\[minmax\\(0\\,1fr\\)_18rem\\]')).toBeNull();
    unmount();

    const withAside = renderPage({ aside: <p>totals</p> });
    expect(screen.getByText('totals')).toBeTruthy();
    expect(
      withAside.container.querySelector('.lg\\:grid-cols-\\[minmax\\(0\\,1fr\\)_18rem\\]')
    ).toBeTruthy();
  });
});

describe('FormActions', () => {
  it('sticks to the bottom on mobile, clear of the iPhone home indicator, and unsticks on desktop', () => {
    const { container } = render(<FormActions primary={<button type="button">Save</button>} />);

    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain('sticky');
    expect(bar.className).toContain('bottom-0');
    // `pb-safe` هي التي تمنع وقوع الزرّ تحت الشريط المنزلق.
    expect(bar.className).toContain('pb-safe');
    expect(bar.className).toContain('lg:static');
  });

  it('drops the sticky bar when a form opts out', () => {
    const { container } = render(
      <FormActions sticky={false} primary={<button type="button">Save</button>} />
    );

    expect((container.firstElementChild as HTMLElement).className).not.toContain('sticky');
  });

  it('gives the primary save twice the width of the secondary actions on mobile', () => {
    const { container } = render(
      <FormActions
        secondary={<button type="button">Cancel</button>}
        primary={<button type="button">Save</button>}
      />
    );

    const row = container.querySelector('.lg\\:justify-end') as HTMLElement;
    const [secondary, primary] = Array.from(row.children) as HTMLElement[];
    expect(secondary.className).toContain('flex-1');
    expect(primary.className).toContain('flex-[2]');
  });

  it('lays several secondary buttons out in one row rather than stacking them', async () => {
    const { container } = render(
      <FormActions
        secondary={<>
          <button type="button">Cancel</button>
          <button type="button">Save draft</button>
        </>}
        primary={<button type="button">Save and post</button>}
      />
    );

    const secondaryGroup = container.querySelector('.lg\\:justify-end')!.firstElementChild as HTMLElement;
    expect(secondaryGroup.className).toContain('flex');
    expect(within(secondaryGroup).getAllByRole('button')).toHaveLength(2);
  });

  it('keeps a destructive action away from the save buttons', () => {
    const { container } = render(
      <FormActions
        destructive={<button type="button">Delete</button>}
        primary={<button type="button">Save</button>}
      />
    );

    const row = container.querySelector('.lg\\:justify-end') as HTMLElement;
    const destructive = row.firstElementChild as HTMLElement;
    expect(within(destructive).getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(destructive.className).toContain('me-auto');
  });

  it('surfaces a note above the buttons', () => {
    render(<FormActions note="Entry is not balanced" primary={<button type="button">Save</button>} />);

    expect(screen.getByText('Entry is not balanced')).toBeTruthy();
  });

  it('leaves the passed-in buttons wired to their own handlers', async () => {
    const onSave = vi.fn();
    render(<FormActions primary={<button type="button" onClick={onSave}>Save</button>} />);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledOnce();
  });
});
