const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };

// Card tags come from a "Stack: A, B, C" line in the project content, which the owner edits in the admin editor.
export function extractStackTags(content: string | null): string[] {
  const text = (content ?? '').replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6])>/gi, '\n').replace(/<[^>]*>/g, '');
  const line = text.match(/^\s*stack:\s*(.+)$/im)?.[1];
  if (!line) return [];

  return line
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => ENTITIES[name])
    .trim()
    .replace(/\.$/, '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}
