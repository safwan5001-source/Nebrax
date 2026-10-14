// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { TypedConfirmationField } from '@/components/shared/typed-confirmation-field';
import { renderIntl } from '@/test-utils/intl';

afterEach(cleanup);

function Harness({ expected = 'Store-100', disabled = false }: { expected?: string; disabled?: boolean }) {
  const [value, setValue] = useState('');
  return (
    <>
      <TypedConfirmationField value={value} onChange={setValue} label="Type the store ID" expected={expected} disabled={disabled} />
      <output data-testid="match">{value === expected ? 'yes' : 'no'}</output>
    </>
  );
}

describe('TypedConfirmationField', () => {
  it('shows the expected value LTR, labels the input, and is a plain text field without autofill or spellcheck', () => {
    renderIntl(<Harness />, 'ar');
    expect(screen.getByTestId('typed-confirmation-expected').textContent).toBe('Store-100');
    expect(screen.getByTestId('typed-confirmation-expected').getAttribute('dir')).toBe('ltr');
    const input = screen.getByLabelText('Type the store ID') as HTMLInputElement;
    expect(input.getAttribute('dir')).toBe('ltr');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.getAttribute('autocapitalize')).toBe('none');
    expect(input.value).toBe('');
  });

  it('matching is literal: case and surrounding spaces matter', () => {
    renderIntl(<Harness />, 'en');
    const input = screen.getByLabelText('Type the store ID');
    for (const [typed, expected] of [['store-100', 'no'], ['Store-100 ', 'no'], [' Store-100', 'no'], ['Store-10', 'no'], ['Store-100', 'yes']] as const) {
      fireEvent.change(input, { target: { value: typed } });
      expect(screen.getByTestId('match').textContent, JSON.stringify(typed)).toBe(expected);
    }
  });

  it('is inert while disabled', () => {
    renderIntl(<Harness disabled />, 'en');
    expect((screen.getByLabelText('Type the store ID') as HTMLInputElement).disabled).toBe(true);
  });
});
