import { openai } from '@ai-sdk/openai';
import { Container, db, ProjectsRepository } from '@bg/core';
import { AskController } from './ask/ask.controller';
import { loadCvText } from './ask/cv-knowledge';
import { createRateLimiter } from './ask/rate-limit';
import { ProjectController } from './project/project.controller';

export const container = new Container();

container.registerFactory(ProjectsRepository, () => {
  return new ProjectsRepository(db);
});

container.registerFactory(ProjectController, (c) => {
  return new ProjectController(c.resolve(ProjectsRepository));
});

container.registerFactory(AskController, () => {
  return new AskController({
    model: process.env.OPENAI_API_KEY ? openai(process.env.OPENAI_MODEL || 'gpt-5.4-mini') : null,
    rateLimiter: createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 }),
    loadCvText,
  });
});
