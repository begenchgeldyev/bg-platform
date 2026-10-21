// Material Symbol names offered to the owner on the admin page. Cards with no stored icon get the guess.
export const PROJECT_ICONS = [
  'terminal',
  'code',
  'web',
  'smart_toy',
  'database',
  'cloud',
  'api',
  'dns',
  'memory',
  'developer_board',
  'hub',
  'storage',
  'bolt',
  'rocket_launch',
  'extension',
  'sports_esports',
  'phone_iphone',
  'analytics',
  'security',
  'school',
] as const;

export function guessProjectIcon(name: string, description: string | null): string {
  const text = `${name} ${description ?? ''}`.toLowerCase();
  if (/\bbot\b/.test(text)) return 'smart_toy';
  if (/\bweb|\bsite\b|\bportfolio\b|\bblog\b/.test(text)) return 'web';
  return 'terminal';
}

export function projectIcon(project: { icon: string | null; name: string; description: string | null }): string {
  const stored = project.icon;
  if (stored && (PROJECT_ICONS as readonly string[]).includes(stored)) {
    return stored;
  }

  return guessProjectIcon(project.name, project.description);
}
