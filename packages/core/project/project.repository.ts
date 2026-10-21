import { desc, eq } from 'drizzle-orm';
import { Injectable } from '../DIContainer';
import { type Db, projects } from '../db';

type Project = typeof projects.$inferSelect;

export type ProjectInput = {
  name: string;
  description: string | null;
  content: string | null;
  image: string | null;
  isHidden: boolean;
  icon: string | null;
  tags: string[];
};

@Injectable()
export class ProjectsRepository {
  constructor(private readonly db: Db) {}

  list({ includeHidden }: { includeHidden: boolean }): Promise<Project[]> {
    return this.db
      .select()
      .from(projects)
      .where(includeHidden ? undefined : eq(projects.isHidden, false))
      .orderBy(desc(projects.createdAt));
  }

  async findById(id: number): Promise<Project | null> {
    const [project] = await this.db.select().from(projects).where(eq(projects.id, id)).limit(1);
    return project ?? null;
  }

  async create(input: ProjectInput): Promise<Project> {
    const [project] = await this.db.insert(projects).values(input).returning();
    if (!project) {
      throw new Error('Inserting a project returned no row');
    }

    return project;
  }

  async updateById(id: number, changes: Partial<ProjectInput>): Promise<Project | null> {
    const [updated] = await this.db
      .update(projects)
      .set({
        ...changes,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id))
      .returning();

    return updated ?? null;
  }

  async deleteById(id: number): Promise<boolean> {
    const deleted = await this.db.delete(projects).where(eq(projects.id, id)).returning({ id: projects.id });
    return deleted.length > 0;
  }
}
