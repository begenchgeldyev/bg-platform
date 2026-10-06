import { describe, expect, test } from 'bun:test';
import { localizedFragmentFile } from './i18n';
import { renderPage } from './site';

describe('renderPage language selection', () => {
  test('renders the English fragment by default', async () => {
    const res = await renderPage('/cv', 'en');
    expect(res).not.toBeNull();
    const html = await (res as Response).text();
    expect(html).toContain('Experience');
  });

  test('derives the translated filename and still serves 200', async () => {
    expect(localizedFragmentFile('nonexistent.html', 'ru')).toBe('nonexistent.ru.html');

    const res = await renderPage('/cv', 'ru');
    expect((res as Response).status).toBe(200);
  });

  test('returns null for an unknown path', async () => {
    expect(await renderPage('/nope', 'en')).toBeNull();
  });

  test('sets the html lang attribute from the language', async () => {
    const res = await renderPage('/cv', 'ru');
    const html = await (res as Response).text();
    expect(html).toContain('lang="ru"');
  });
});

describe('include resolution', () => {
  test('resolves an include whose filename contains a hyphen', async () => {
    const res = await renderPage('/cv', 'en');
    const html = await (res as Response).text();
    expect(html).toContain('mouseenter');
    expect(html).not.toContain('#include');
  });
});

describe('chrome translation', () => {
  test('renders English navigation labels by default', async () => {
    const res = await renderPage('/cv', 'en');
    const html = await (res as Response).text();
    expect(html).toContain('>Projects<');
    expect(html).toContain('>Logs<');
  });

  test('renders Russian navigation labels', async () => {
    const res = await renderPage('/cv', 'ru');
    const html = await (res as Response).text();
    expect(html).toContain('>Проекты<');
    expect(html).toContain('>Логи<');
    expect(html).toContain('>Резюме<');
  });

  test('keeps the CV pdf label untranslated', async () => {
    const res = await renderPage('/cv', 'ru');
    const html = await (res as Response).text();
    expect(html).toContain('CV.pdf');
  });
});

describe('russian fragments', () => {
  test('serves Russian CV prose', async () => {
    const res = await renderPage('/cv', 'ru');
    const html = await (res as Response).text();
    expect(html).toContain('Опыт');
    expect(html).not.toContain('Software and hardware for radio-frequency');
  });

  test('keeps stack names untranslated', async () => {
    const res = await renderPage('/cv', 'ru');
    const html = await (res as Response).text();
    expect(html).toContain('Feature-Sliced Design');
    expect(html).toContain('TypeScript');
    expect(html).toContain('SCPI / HiSLIP');
  });

  test('still serves English prose on the English page', async () => {
    const res = await renderPage('/cv', 'en');
    const html = await (res as Response).text();
    expect(html).toContain('Software and hardware for radio-frequency');
  });

  test('serves Russian copy on the home page', async () => {
    const res = await renderPage('/', 'ru');
    const html = await (res as Response).text();
    expect(html).toContain('Избранные работы');
    expect(html).toContain('terminal-display');
  });
});

describe('htmx setup', () => {
  test('configures htmx 4 before it loads so 4xx/5xx responses are not swapped, as in htmx 2', async () => {
    const res = await renderPage('/projects', 'en');
    const html = await (res as Response).text();
    const config = html.match(/<meta name="htmx-config" content='([^']+)'>/)?.[1];
    expect(config).toBeDefined();
    expect(JSON.parse(config ?? '{}')).toEqual({ noSwap: [204, 304, '4xx', '5xx'] });
    expect(html.indexOf('name="htmx-config"')).toBeLessThan(html.indexOf('htmx.org@4.0.0'));
  });
});
