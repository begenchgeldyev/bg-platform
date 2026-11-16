export const PROJECT_URL_MAX_CHARS = 2048;

type ProjectUrlField = 'githubUrl' | 'liveUrl';
type ProjectUrlResult = { ok: true; value: string | null } | { ok: false; error: string };

function hasUrlControl(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || (code >= 127 && code <= 159)) return true;
  }
  return false;
}

// Validate without fetching or inferring destinations. Keep the trimmed input so save
// and defensive rendering share exactly the same rules and do not rewrite owner copy.
export function parseProjectUrl(value: unknown, field: ProjectUrlField): ProjectUrlResult {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: `${field} must be a URL or blank` };

  const invalid = (): ProjectUrlResult => ({
    ok: false,
    error:
      field === 'githubUrl'
        ? 'githubUrl must be an HTTPS github.com repository URL without credentials (https://github.com/owner/repository)'
        : 'liveUrl must be an absolute HTTP or HTTPS URL without credentials',
  });
  // URL() silently removes tabs/newlines and repairs missing slashes/backslashes;
  // reject those spellings rather than letting save and the browser disagree.
  if (hasUrlControl(value)) return invalid();
  const url = value.trim();
  if (!url) return { ok: true, value: null };
  if (url.length > PROJECT_URL_MAX_CHARS) return { ok: false, error: `${field} must be ${PROJECT_URL_MAX_CHARS} characters or fewer` };
  if (/\s|\\/.test(url)) return invalid();
  try {
    // Decode once for validation only: invalid UTF-8 and encoded C0/C1 controls
    // are unsafe, but continuation bytes in valid Unicode (e.g. Cyrillic) are not.
    // Keep the original URL below, including allowed encoded separators.
    if (hasUrlControl(decodeURIComponent(url))) return invalid();
  } catch {
    return invalid();
  }
  const absolute = /^https?:\/\/([^/?#]+)([^?#]*)/i.exec(url);
  if (!absolute || absolute[1]?.includes('@')) return invalid();

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return invalid();
  }
  if (!parsed.hostname || parsed.username || parsed.password || !['https:', 'http:'].includes(parsed.protocol)) return invalid();

  if (field === 'githubUrl') {
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || parsed.port) return invalid();
    const segments = (absolute[2] ?? '').split('/').slice(1);
    const [owner, repository] = segments;
    if (!owner || !repository || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repository)) return invalid();
    // Reject dot segments before URL normalization can turn a non-repository
    // spelling into a seemingly valid owner/repository path.
    if (segments.some((segment) => /^(?:\.|%2e){1,2}$/i.test(segment))) return invalid();
  }

  return { ok: true, value: url };
}
