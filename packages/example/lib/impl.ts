export function normalizeTagsImpl(tags: readonly string[]): string[] {
  const normalized = tags.map((tag) => tag.trim().replace(/\s+/g, ' ').toLowerCase()).filter(Boolean);
  return [...new Set(normalized)];
}
