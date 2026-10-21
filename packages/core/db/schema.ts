import { sql } from 'drizzle-orm';
import { boolean, jsonb, pgEnum, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const projects = pgTable('projects', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  content: text('content'),
  image: text('image'),
  isHidden: boolean('is_hidden').notNull().default(false),
  icon: text('icon'),
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const roleEnum = pgEnum('role', ['owner', 'editor', 'viewer']);
export const effectEnum = pgEnum('effect', ['allow', 'deny']);
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  role: roleEnum('role').notNull().default('viewer'),
  attributes: jsonb('attributes').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const policies = pgTable('policies', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  effect: effectEnum('effect').notNull(),
  subjectCondition: jsonb('subject_condition').notNull(),
  action: text('action').notNull(),
  resource: text('resource').notNull(),
  resourceCondition: jsonb('resource_condition').notNull().default({}),
  contextCondition: jsonb('context_condition').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
