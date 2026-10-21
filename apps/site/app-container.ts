import { openai } from '@ai-sdk/openai';
import { Container, canAccess, db, ProjectsRepository, resolveEmail } from '@bg/core';
import { AskController } from './ask/ask.controller';
import { loadCvText } from './ask/cv-knowledge';
import { AuthController } from './auth/auth.controller';
import { createRateLimiter } from './http/rate-limit';
import { type CanEditProjects, ProjectController } from './project/project.controller';

export const container = new Container();

container.registerFactory(ProjectsRepository, () => {
  return new ProjectsRepository(db);
});

// A visitor's page view must not pay for a policy lookup, and only a signed session can hold edit rights.
const canEditProjects: CanEditProjects = async (req) => {
  if (!resolveEmail(req)) {
    return false;
  }

  return canAccess(req, { actions: 'update', resource: 'project' });
};

container.registerFactory(ProjectController, (c) => {
  return new ProjectController(c.resolve(ProjectsRepository), canEditProjects);
});

container.registerFactory(AskController, () => {
  return new AskController({
    model: process.env.OPENAI_API_KEY ? openai(process.env.OPENAI_MODEL || 'gpt-5.4-mini') : null,
    rateLimiter: createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 }),
    loadCvText,
  });
});

container.registerFactory(AuthController, () => {
  return new AuthController({
    adminSecret: process.env.ADMIN_SECRET,
    rateLimiter: createRateLimiter({ limit: 5, windowMs: 15 * 60 * 1000 }),
    secureCookies: process.env.NODE_ENV === 'production',
  });
});
