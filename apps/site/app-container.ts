import { Container, db, ProjectsRepository, projectAccess } from '@bg/core';
import { AdminController } from './admin/admin.controller';
import { AskController } from './ask/ask.controller';
import { loadCvText } from './ask/cv-knowledge';
import { createAskModel } from './ask/model-config';
import { AuthController } from './auth/auth.controller';
import { createRateLimiter } from './http/rate-limit';
import { ProjectController } from './project/project.controller';

export const container = new Container();

container.registerFactory(ProjectsRepository, () => {
  return new ProjectsRepository(db);
});

container.registerFactory(ProjectController, (c) => {
  return new ProjectController(c.resolve(ProjectsRepository), projectAccess);
});

container.registerFactory(AdminController, (c) => {
  return new AdminController({
    projectsRepository: c.resolve(ProjectsRepository),
    projectAccess,
  });
});

container.registerFactory(AskController, (c) => {
  return new AskController({
    model: createAskModel(),
    rateLimiter: createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 }),
    loadCvText,
    listPublicProjects: () => c.resolve(ProjectsRepository).list({ includeHidden: false }),
  });
});

container.registerFactory(AuthController, () => {
  return new AuthController({
    adminSecret: process.env.ADMIN_SECRET,
    rateLimiter: createRateLimiter({ limit: 5, windowMs: 15 * 60 * 1000 }),
    secureCookies: process.env.NODE_ENV === 'production',
  });
});
