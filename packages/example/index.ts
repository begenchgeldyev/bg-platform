import { normalizeTagsImpl } from './lib/impl';

/** Trim, lowercase, and deduplicate tags without changing the input. */
export function normalizeTags(tags: readonly string[]): string[] {
  return normalizeTagsImpl(tags);
}
