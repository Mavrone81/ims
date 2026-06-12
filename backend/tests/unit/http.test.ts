import { describe, it, expect } from 'vitest';
import { toCsv, getSort } from '../../src/utils/http.js';

describe('toCsv', () => {
  it('serializes rows with a header line', () => {
    const csv = toCsv([{ a: 1, b: 'x' }], [
      { header: 'A', key: 'a' },
      { header: 'B', key: 'b' },
    ]);
    expect(csv).toBe('A,B\n1,x');
  });

  it('quotes fields containing commas, quotes, or newlines', () => {
    const csv = toCsv([{ a: 'he,llo', b: 'qu"ote' }], [
      { header: 'A', key: 'a' },
      { header: 'B', key: 'b' },
    ]);
    expect(csv).toBe('A,B\n"he,llo","qu""ote"');
  });

  it('renders null/undefined as empty', () => {
    const csv = toCsv([{ a: null, b: undefined }], [
      { header: 'A', key: 'a' },
      { header: 'B', key: 'b' },
    ]);
    expect(csv).toBe('A,B\n,');
  });
});

describe('getSort', () => {
  const allowed = { item_no: 'i.item_no', price: 'i.unit_price' };
  it('maps a whitelisted column with direction', () => {
    expect(getSort({ query: { sort: 'price', order: 'desc' } } as any, allowed, 'i.item_no ASC')).toBe('i.unit_price DESC');
  });
  it('falls back for unknown/injection input', () => {
    expect(getSort({ query: { sort: '(SELECT 1)', order: ';DROP' } } as any, allowed, 'i.item_no ASC')).toBe('i.item_no ASC');
  });
});
