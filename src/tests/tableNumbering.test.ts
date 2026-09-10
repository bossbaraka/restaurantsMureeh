import { describe, expect, it } from 'vitest';
import { formatTableNumber, resolveTableDisplayNumber } from '../utils/formatting';

/**
 * Regression coverage for the table-numbering bug: table IDs are opaque
 * (UUIDs or `{tenant}-T{n}` composites), so displaying a number scraped out
 * of the ID showed customers a different number than the one printed on the
 * table's QR card. The registry `tableNumber` must always win.
 */
describe('resolveTableDisplayNumber', () => {
  const tables = [
    { id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', tableNumber: 7 },
    { id: 'rest-uuid-9f2e-T03', tableNumber: 3 },
  ];

  it('returns the registry tableNumber for UUID table IDs (the QR card number)', () => {
    expect(resolveTableDisplayNumber(tables, 'f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe('7');
  });

  it('returns the registry tableNumber for legacy composite IDs', () => {
    expect(resolveTableDisplayNumber(tables, 'rest-uuid-9f2e-T03')).toBe('3');
  });

  it('ignores digits embedded in the table ID itself', () => {
    // Without the registry match, parsing the ID would have produced "47".
    expect(resolveTableDisplayNumber(tables, 'f47ac10b-58cc-4372-a567-0e02b2c3d479')).not.toBe('47');
  });

  it('falls back to the legacy ID parsing when the table is not in the registry', () => {
    expect(resolveTableDisplayNumber(tables, 'other-rest-T12')).toBe('12');
    expect(resolveTableDisplayNumber([], 'TABLE-09')).toBe('9');
  });

  it('keeps special IDs such as walk-in readable', () => {
    expect(resolveTableDisplayNumber(tables, '__WALKIN__')).toBe('عميل مباشر');
  });

  it('falls back when the registry row has no usable number', () => {
    const broken = [
      { id: 'a-T05', tableNumber: 0 },
      { id: 'b-T06', tableNumber: Number.NaN },
      { id: 'c-T07', tableNumber: null },
    ];
    expect(resolveTableDisplayNumber(broken, 'a-T05')).toBe('5');
    expect(resolveTableDisplayNumber(broken, 'b-T06')).toBe('6');
    expect(resolveTableDisplayNumber(broken, 'c-T07')).toBe('7');
  });

  it('handles missing IDs and missing registry safely', () => {
    expect(resolveTableDisplayNumber(tables, null)).toBe('');
    expect(resolveTableDisplayNumber(tables, undefined)).toBe('');
    expect(resolveTableDisplayNumber(null, 'x-T04')).toBe('4');
    expect(resolveTableDisplayNumber(undefined, 'x-T04')).toBe('4');
  });
});

describe('formatTableNumber (legacy fallback semantics preserved)', () => {
  it('strips -T / TABLE- prefixes', () => {
    expect(formatTableNumber('rest-merar-T01')).toBe('1');
    expect(formatTableNumber('TABLE-05')).toBe('5');
  });
});
