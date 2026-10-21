const FULL_ROW = 12;
const FEATURED_ROW = [8, 4];

export function cardColSpans(total: number): number[] {
  if (total <= 0) {
    return [];
  }

  if (total === 1) {
    return [FULL_ROW];
  }

  const spans = [...FEATURED_ROW];
  const remaining = total - FEATURED_ROW.length;

  if (remaining === 1) {
    spans.push(FULL_ROW);
  } else if (remaining % 2 === 1) {
    spans.push(4, 4, 4);
    for (let i = 3; i < remaining; i += 1) {
      spans.push(6);
    }
  } else {
    for (let i = 0; i < remaining; i += 1) {
      spans.push(6);
    }
  }

  return spans;
}
