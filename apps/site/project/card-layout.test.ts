import { describe, expect, test } from 'bun:test';
import { cardColSpans } from './card-layout';

const approvedLayouts: Record<number, number[]> = {
  1: [12],
  2: [8, 4],
  3: [8, 4, 12],
  4: [8, 4, 6, 6],
  5: [8, 4, 4, 4, 4],
  6: [8, 4, 6, 6, 6, 6],
};

describe('cardColSpans', () => {
  test('matches the approved layout for totals 1 to 6', () => {
    for (const [total, spans] of Object.entries(approvedLayouts)) {
      expect(cardColSpans(Number(total))).toEqual(spans);
    }
  });

  test('packs every total from 1 to 10 into full 12-column rows', () => {
    for (let total = 1; total <= 10; total += 1) {
      const spans = cardColSpans(total);
      expect(spans).toHaveLength(total);

      let row = 0;
      for (const span of spans) {
        row += span;
        expect(row).toBeLessThanOrEqual(12);
        if (row === 12) {
          row = 0;
        }
      }
      expect(row).toBe(0);
    }
  });
});
