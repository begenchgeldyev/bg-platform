import { jsonSchema, tool } from 'ai';
import { htmlToText } from './resume-knowledge';

export const TOOL_LIMITS = { calls: 4, resultChars: 6000, rows: 5, queryChars: 80 } as const;

// These are virtual site documents, not paths. Keep their content aligned with the
// manual terminal's FILES. No filesystem, URL fetching or command execution here.
const FILES = {
  'philosophy.txt':
    'Performance is not a feature; it is a fundamental requirement.\nCode should be as readable as prose and as robust as industrial steel.\nUser experience is the ultimate metric of success in any technical architecture.',
  'skills.txt':
    'frontend: React, TypeScript, HTMX, Tailwind CSS\nbackend: Go, Node.js, Bun, REST, gRPC\ntools: Neovim, Tmux, Git, Docker, Linux\ndatabases: PostgreSQL, MongoDB, Redis',
  'contact.txt': 'email: begenchgeldyev@gmail.com\ngithub: github.com/begenchgeldyev\nlinkedin: linkedin.com/in/begench-geldyev',
};

export type VirtualToolDeps = {
  loadResumeText: () => Promise<string>;
  listPublicProjects?: () => Promise<unknown[]>;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validInput(kind: 'empty' | 'cat' | 'projects', value: unknown): value is Record<string, unknown> {
  if (!record(value)) return false;
  const keys = Object.keys(value);
  if (kind === 'empty') return keys.length === 0;
  if (kind === 'cat') return keys.length === 1 && typeof value.filename === 'string' && Object.hasOwn(FILES, value.filename);
  return (
    keys.every((key) => key === 'query') &&
    (value.query === undefined || (typeof value.query === 'string' && value.query.length <= TOOL_LIMITS.queryChars))
  );
}

function inputSchema(kind: 'empty' | 'cat' | 'projects') {
  const properties =
    kind === 'cat'
      ? { filename: { type: 'string', enum: Object.keys(FILES) } }
      : kind === 'projects'
        ? { query: { type: 'string', maxLength: TOOL_LIMITS.queryChars } }
        : {};
  return jsonSchema<Record<string, unknown>>(
    {
      type: 'object',
      properties,
      additionalProperties: false,
      required: kind === 'cat' ? ['filename'] : [],
    },
    {
      // jsonSchema alone does NOT validate model input at runtime in AI SDK 7.
      validate: (value) =>
        validInput(kind, value) ? { success: true, value } : { success: false, error: new Error('Invalid virtual site tool input') },
    },
  );
}

export function plainBounded(value: unknown, maxChars: number): string {
  return typeof value === 'string' ? htmlToText(value.slice(0, 20000)).slice(0, maxChars) : '';
}

// Stop waiting on a repository/Resume callback when the request ends. The repository
// interface itself has no cancellation API; its eventual result is never exposed.
export function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Request ended'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function createVirtualTools(deps: VirtualToolDeps, signal: AbortSignal) {
  let calls = 0;
  let disabled = false;
  const wrap =
    (kind: 'empty' | 'cat' | 'projects', run: (input: Record<string, unknown>) => Promise<string>) =>
    async (input: Record<string, unknown>) => {
      // Synchronous reservation also bounds parallel calls. Validate defensively
      // even when invoked outside the SDK; never trust a schema description alone.
      if (!validInput(kind, input)) return 'Invalid virtual site tool input.';
      if (disabled || signal.aborted || calls >= TOOL_LIMITS.calls) return 'Virtual site tool limit reached.';
      calls++;
      try {
        return (await withAbort(run(input), signal)).slice(0, TOOL_LIMITS.resultChars);
      } catch {
        return 'Site information is unavailable right now.';
      }
    };

  return {
    disable: () => {
      disabled = true;
    },
    tools: {
      whoami: tool({
        description: 'Read Begench’s public Resume/profile. Read-only virtual site command, never a shell.',
        inputSchema: inputSchema('empty'),
        execute: wrap('empty', async () => plainBounded(await deps.loadResumeText(), TOOL_LIMITS.resultChars)),
      }),
      ls: tool({
        description: 'List the readable virtual site filenames.',
        inputSchema: inputSchema('empty'),
        execute: wrap('empty', async () => Object.keys(FILES).join('\n')),
      }),
      cat: tool({
        description: 'Read one allowlisted virtual site document. No real paths.',
        inputSchema: inputSchema('cat'),
        execute: wrap('cat', async ({ filename }) => FILES[filename as keyof typeof FILES]),
      }),
      projects: tool({
        description: 'Look up public portfolio projects, optionally by a short text query. Returns data only; never navigates.',
        inputSchema: inputSchema('projects'),
        execute: wrap('projects', async ({ query }) => {
          if (!deps.listPublicProjects) return 'Public projects are unavailable right now.';
          const rows = await deps.listPublicProjects();
          if (!Array.isArray(rows)) return 'Public projects are unavailable right now.';
          const search = typeof query === 'string' ? query.trim().toLowerCase() : '';
          const projects = [];
          // Bound processing even if a faulty repository returns excessive rows.
          for (const row of rows.slice(0, 200)) {
            if (!record(row) || row.isHidden !== false || !Number.isSafeInteger(row.id) || Number(row.id) <= 0) continue;
            const project = {
              id: row.id,
              name: plainBounded(row.name, 120),
              description: plainBounded(row.description, 300),
              content: plainBounded(row.content, 500),
              tags: Array.isArray(row.tags) ? row.tags.slice(0, 8).map((tag) => plainBounded(tag, 40)) : [],
            };
            if (
              search &&
              !`${project.name} ${project.description} ${project.content} ${project.tags.join(' ')}`.toLowerCase().includes(search)
            )
              continue;
            // JSON escaping can expand even individually bounded fields. Admit
            // only complete rows so the wrapper's final cap never splits JSON.
            if (JSON.stringify([...projects, project]).length > TOOL_LIMITS.resultChars) continue;
            projects.push(project);
            if (projects.length >= TOOL_LIMITS.rows) break;
          }
          return JSON.stringify(projects);
        }),
      }),
    },
  };
}
