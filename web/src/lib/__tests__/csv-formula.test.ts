import { describe, expect, it } from 'vitest';
import { formulaSafeCsv, spreadsheetCell } from '@/lib/csv-formula';

describe('spreadsheet formula neutralization', () => {
  it('prefixes formula-leading text and keeps a negative amount numeric', () => {
    expect(spreadsheetCell('=1+1')).toBe("'=1+1");
    expect(spreadsheetCell('+1')).toBe("'+1");
    expect(spreadsheetCell('-2+3')).toBe("'-2+3");
    expect(spreadsheetCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(spreadsheetCell('\t=1')).toBe("'\t=1");
    expect(spreadsheetCell('\r=1')).toBe("'\r=1");
    expect(spreadsheetCell(' =1+1')).toBe("' =1+1");
    expect(spreadsheetCell('-10.50')).toBe('-10.50');
    expect(spreadsheetCell('-0.25')).toBe('-0.25');
    expect(spreadsheetCell( -10.5)).toBe(-10.5);
    expect(spreadsheetCell('INV-1')).toBe('INV-1');
  });

  it('neutralizes before delimiter escaping and does not change stored-looking text until export', () => {
    const csv = formulaSafeCsv(
      ['=Name', 'amount', 'reference'],
      [
        ['=هنقر', '-10.50', '=1+1'],
        ['+1', '-2.00', 'jahez, branch'],
      ],
    );
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.replace('\uFEFF', '').split('\r\n');
    expect(lines[0]).toBe("'=Name,amount,reference");
    expect(lines[1]).toBe(`'=هنقر,-10.50,'=1+1`);
    expect(lines[2]).toBe(`'+1,-2.00,"jahez, branch"`);
    expect(lines[1]).not.toContain(',=-');
    expect(csv).not.toContain(",=1+1");
  });
});
