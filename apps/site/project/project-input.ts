import type { ProjectInput } from '@bg/core';
import { PROJECT_ICONS } from './project-icons';

export const PROJECT_LIMITS = {
  maxBodyBytes: 4 * 1024 * 1024,
  maxImageBytes: 2 * 1024 * 1024,
  maxNameChars: 120,
  maxDescriptionChars: 600,
  maxContentChars: 100_000,
  maxTags: 12,
  maxTagChars: 40,
} as const;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/]*={0,2})$/;

function asRecord(body: unknown): Record<string, unknown> | null {
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

function parseName(value: unknown): ParseResult<string> {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) return { ok: false, error: 'name is required' };
  if (name.length > PROJECT_LIMITS.maxNameChars) return { ok: false, error: 'name is too long' };
  return { ok: true, value: name };
}

function parseText(value: unknown, field: 'description' | 'content', maxChars: number): ParseResult<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: `${field} must be text` };
  if (value.trim().length > maxChars) return { ok: false, error: `${field} is too long` };
  return { ok: true, value: value.trim() === '' ? null : value };
}

function parseImage(value: unknown): ParseResult<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: 'photo must be an uploaded image' };

  const image = value.trim();
  if (!image) return { ok: true, value: null };
  if (image.startsWith('/public/') && !image.includes('..')) return { ok: true, value: image };

  const dataUrl = DATA_IMAGE.exec(image);
  if (!dataUrl) return { ok: false, error: 'photo must be an uploaded image' };

  const payload = dataUrl[1] ?? '';
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  const bytes = Math.floor((payload.length * 3) / 4) - padding;
  if (bytes > PROJECT_LIMITS.maxImageBytes) return { ok: false, error: 'photo must be 2 MB or smaller' };

  return { ok: true, value: image };
}

function parseIcon(value: unknown): ParseResult<string | null> {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value === 'string' && (PROJECT_ICONS as readonly string[]).includes(value)) return { ok: true, value };
  return { ok: false, error: 'unknown icon' };
}

function parseTags(value: unknown): ParseResult<string[]> {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string')) return { ok: false, error: 'tags must be a list' };

  const tags: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const tag = raw.trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }

  if (tags.length > PROJECT_LIMITS.maxTags) return { ok: false, error: 'at most 12 tags' };
  if (tags.some((tag) => tag.length > PROJECT_LIMITS.maxTagChars)) return { ok: false, error: 'tags are limited to 40 characters' };
  return { ok: true, value: tags };
}

function parseIsHidden(value: unknown): ParseResult<boolean> {
  if (value === undefined) return { ok: true, value: false };
  if (typeof value !== 'boolean') return { ok: false, error: 'isHidden must be true or false' };
  return { ok: true, value };
}

export function parseNewProject(body: unknown): ParseResult<ProjectInput> {
  const record = asRecord(body);
  if (!record) return { ok: false, error: 'body must be a JSON object' };

  const name = parseName(record.name);
  if (!name.ok) return name;
  const description = parseText(record.description, 'description', PROJECT_LIMITS.maxDescriptionChars);
  if (!description.ok) return description;
  const content = parseText(record.content, 'content', PROJECT_LIMITS.maxContentChars);
  if (!content.ok) return content;
  const image = parseImage(record.image);
  if (!image.ok) return image;
  const icon = parseIcon(record.icon);
  if (!icon.ok) return icon;
  const tags = parseTags(record.tags);
  if (!tags.ok) return tags;
  const isHidden = parseIsHidden(record.isHidden);
  if (!isHidden.ok) return isHidden;

  return {
    ok: true,
    value: {
      name: name.value,
      description: description.value,
      content: content.value,
      image: image.value,
      isHidden: isHidden.value,
      icon: icon.value,
      tags: tags.value,
    },
  };
}

export function parseProjectChanges(body: unknown): ParseResult<Partial<ProjectInput>> {
  const record = asRecord(body);
  if (!record) return { ok: false, error: 'body must be a JSON object' };

  const changes: Partial<ProjectInput> = {};

  if (record.name !== undefined) {
    const name = parseName(record.name);
    if (!name.ok) return name;
    changes.name = name.value;
  }

  if (record.description !== undefined) {
    const description = parseText(record.description, 'description', PROJECT_LIMITS.maxDescriptionChars);
    if (!description.ok) return description;
    changes.description = description.value;
  }

  if (record.content !== undefined) {
    const content = parseText(record.content, 'content', PROJECT_LIMITS.maxContentChars);
    if (!content.ok) return content;
    changes.content = content.value;
  }

  if (record.image !== undefined) {
    const image = parseImage(record.image);
    if (!image.ok) return image;
    changes.image = image.value;
  }

  if (record.icon !== undefined) {
    const icon = parseIcon(record.icon);
    if (!icon.ok) return icon;
    changes.icon = icon.value;
  }

  if (record.tags !== undefined) {
    const tags = parseTags(record.tags);
    if (!tags.ok) return tags;
    changes.tags = tags.value;
  }

  if (record.isHidden !== undefined) {
    const isHidden = parseIsHidden(record.isHidden);
    if (!isHidden.ok) return isHidden;
    changes.isHidden = isHidden.value;
  }

  if (Object.keys(changes).length === 0) return { ok: false, error: 'nothing to update' };
  return { ok: true, value: changes };
}
