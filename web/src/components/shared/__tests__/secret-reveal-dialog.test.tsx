// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SecretRevealDialog, type SecretRevealLabels } from '@/components/shared/secret-reveal-dialog';
import { renderIntl } from '@/test-utils/intl';

const SECRET = 'dsec_SENTINEL_ONE_TIME_SECRET_0123456789abcdef';
const OTHER = 'dsec_SENTINEL_SECOND_SECRET_fedcba9876543210';

const LABELS: SecretRevealLabels = {
  warning: 'Shown once only.',
  copied: 'Copied.',
  confirm: 'I saved it',
  confirmHint: 'Confirm you saved it first.',
  reveal: 'Show',
  hide: 'Hide',
  copy: 'Copy value',
};

function mount(props: Partial<React.ComponentProps<typeof SecretRevealDialog>> = {}, locale: 'ar' | 'en' = 'en') {
  const onClose = vi.fn();
  const view = renderIntl(<SecretRevealDialog open title="Signing secret" secret={SECRET} labels={LABELS} onClose={onClose} {...props} />, locale);
  return { onClose, ...view };
}

const doneButton = () => screen.getAllByRole('button', { name: 'I saved it' }).find((b) => b.tagName === 'BUTTON') as HTMLButtonElement;

describe('neutral SecretRevealDialog (security-critical)', () => {
  let local: ReturnType<typeof vi.spyOn>;
  let session: ReturnType<typeof vi.spyOn>;
  let logs: ReturnType<typeof vi.spyOn>[];

  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
    local = vi.spyOn(Storage.prototype, 'setItem');
    session = vi.spyOn(window.sessionStorage, 'setItem');
    logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); document.body.style.overflow = ''; });

  it('uses only the labels it is given, in both locales', () => {
    mount({}, 'ar');
    expect(screen.getByText('Shown once only.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy value' })).toBeTruthy();
  });

  it('is masked by default and the secret is not in the DOM until revealed', () => {
    mount();
    expect(document.body.innerHTML).not.toContain(SECRET);
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByText(SECRET).getAttribute('dir')).toBe('ltr');
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it('never reaches storage, the console, attributes or the title, even after reveal and copy', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy value' })); });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(SECRET);
    for (const call of [...local.mock.calls, ...session.mock.calls]) expect(String(call[1])).not.toContain(SECRET);
    for (const spy of logs) for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(SECRET);
    const attributes = Array.from(document.body.querySelectorAll('*')).flatMap((el) => Array.from(el.attributes).map((a) => a.value));
    expect(attributes.join('|')).not.toContain(SECRET);
    expect(document.title).not.toContain(SECRET);
  });

  it('default behavior is unchanged: Escape and the top close button dismiss at once (backward compatible)', () => {
    const { onClose } = mount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /close|إغلاق/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('the explicit confirmation gate enables the done button', () => {
    const { onClose } = mount();
    expect(doneButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(doneButton().disabled).toBe(false);
    fireEvent.click(doneButton());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('requireConfirmToClose (opt-in lock for secrets that cannot be recovered)', () => {
    it('Escape and backdrop do not close before confirmation, a hint appears, and the top X is hidden (not a dead button)', () => {
      const { onClose, container } = mount({ requireConfirmToClose: true });
      expect(screen.queryByRole('button', { name: /close|إغلاق/i })).toBeNull();
      fireEvent.keyDown(document, { key: 'Escape' });
      const backdrop = container.ownerDocument.querySelector('[aria-hidden="true"].absolute') as HTMLElement | null;
      expect(backdrop).not.toBeNull();
      fireEvent.click(backdrop as HTMLElement);
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId('secret-dismiss-hint').textContent).toBe('Confirm you saved it first.');
    });

    it('the top X returns once the save is confirmed and then closes; without the lock the X is always there (developer behavior unchanged)', () => {
      const locked = mount({ requireConfirmToClose: true });
      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByRole('button', { name: /close|إغلاق/i }));
      expect(locked.onClose).toHaveBeenCalledTimes(1);
      cleanup();

      const plain = mount();
      fireEvent.click(screen.getByRole('button', { name: /close|إغلاق/i }));
      expect(plain.onClose).toHaveBeenCalledTimes(1);
    });

    it('after the explicit confirmation Escape and the done button close it', () => {
      const { onClose } = mount({ requireConfirmToClose: true });
      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('the done button still works and the hint is not shown before any dismiss attempt', () => {
      const { onClose } = mount({ requireConfirmToClose: true });
      expect(screen.queryByTestId('secret-dismiss-hint')).toBeNull();
      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(doneButton());
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('closing resets the internal state: the next secret starts masked, unconfirmed and not "copied"', async () => {
    const onClose = vi.fn();
    const { rerender } = renderIntl(<SecretRevealDialog open title="S" secret={SECRET} labels={LABELS} onClose={onClose} />, 'en');
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy value' })); });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(doneButton());
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<SecretRevealDialog open title="S" secret={OTHER} labels={LABELS} onClose={onClose} />);
    expect(document.body.innerHTML).not.toContain(OTHER);
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect(doneButton().disabled).toBe(true);
    expect(screen.queryByText('Copied.')).toBeNull();
  });

  it('renders nothing (and no secret) when closed', () => {
    mount({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.innerHTML).not.toContain(SECRET);
  });
});
