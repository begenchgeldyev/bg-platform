import { describe, expect, test } from 'bun:test';
import { type Db, type Project, type ProjectInput, ProjectsRepository, projects } from '../index';

const input: ProjectInput = {
  name: 'Demo',
  description: null,
  content: '<p>Existing body links stay unchanged.</p>',
  image: null,
  isHidden: false,
  icon: null,
  tags: [],
  githubUrl: 'https://github.com/owner/repository',
  liveUrl: 'https://example.com/',
};

function fixture() {
  let stored: Project = { ...input, id: 1, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') };
  const inserts: ProjectInput[] = [];
  const updates: Partial<Project>[] = [];
  const db = {
    insert() {
      return {
        values(value: ProjectInput) {
          inserts.push(value);
          stored = { ...stored, ...value };
          return { returning: async () => [stored] };
        },
      };
    },
    update() {
      return {
        set(value: Partial<Project>) {
          updates.push(value);
          stored = { ...stored, ...value };
          return { where: () => ({ returning: async () => [stored] }) };
        },
      };
    },
  } as unknown as Db;
  return { repository: new ProjectsRepository(db), inserts, updates };
}

describe('project destination storage contract', () => {
  test('schema adds nullable text destinations without defaults', () => {
    for (const column of [projects.githubUrl, projects.liveUrl]) {
      expect(column.dataType).toBe('string');
      expect(column.columnType).toBe('PgText');
      expect(column.notNull).toBe(false);
      expect(column.hasDefault).toBe(false);
    }
  });

  test('create passes both destinations through and returns them', async () => {
    const { repository, inserts } = fixture();
    expect(await repository.create(input)).toMatchObject(input);
    expect(inserts).toEqual([input]);
  });

  test('partial updates leave omitted destinations alone and explicit null clears each', async () => {
    const { repository, updates } = fixture();
    expect(await repository.updateById(1, { name: 'Renamed' })).toMatchObject({
      githubUrl: input.githubUrl,
      liveUrl: input.liveUrl,
      content: input.content,
    });
    expect(Object.hasOwn(updates[0] ?? {}, 'githubUrl')).toBe(false);
    expect(Object.hasOwn(updates[0] ?? {}, 'liveUrl')).toBe(false);
    expect(await repository.updateById(1, { githubUrl: null })).toMatchObject({ githubUrl: null, liveUrl: input.liveUrl });
    expect(await repository.updateById(1, { liveUrl: null })).toMatchObject({ githubUrl: null, liveUrl: null, content: input.content });
  });
});
