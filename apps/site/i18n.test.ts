import { describe, expect, test } from 'bun:test';
import { DEFAULT_LANG, isLang, localizedFragmentFile, resolveLang, t } from './i18n';

function reqWithCookie(cookie?: string): Request {
  return new Request('http://localhost/resume', {
    headers: cookie ? { cookie } : {},
  });
}

describe('resolveLang', () => {
  test('defaults to English when no cookie is present', () => {
    expect(resolveLang(reqWithCookie())).toBe('en');
  });

  test('reads ru from the lang cookie', () => {
    expect(resolveLang(reqWithCookie('lang=ru'))).toBe('ru');
  });

  test('reads the lang cookie when other cookies surround it', () => {
    expect(resolveLang(reqWithCookie('dev-user-email=a%40b.c; lang=ru; other=1'))).toBe('ru');
  });

  test('falls back to English for an unknown value', () => {
    expect(resolveLang(reqWithCookie('lang=de'))).toBe('en');
  });

  test('falls back to English for a malformed percent-encoding', () => {
    expect(resolveLang(reqWithCookie('lang=%E0%A4%A'))).toBe('en');
  });

  test('does not match a cookie whose name merely ends in lang', () => {
    expect(resolveLang(reqWithCookie('htmlang=ru'))).toBe('en');
  });
});

describe('isLang', () => {
  test('accepts supported languages', () => {
    expect(isLang('en')).toBe(true);
    expect(isLang('ru')).toBe(true);
  });

  test('rejects anything else', () => {
    expect(isLang('de')).toBe(false);
    expect(isLang(null)).toBe(false);
    expect(isLang(1)).toBe(false);
  });
});

describe('t', () => {
  test('returns the English label', () => {
    expect(t('en', 'navProjects')).toBe('Projects');
  });

  test('returns the Russian label', () => {
    expect(t('ru', 'navProjects')).toBe('Проекты');
  });

  test('translates resume navigation and download actions', () => {
    expect(t('en', 'navResume')).toBe('Resume');
    expect(t('ru', 'navResume')).toBe('Резюме');
    expect(t('en', 'footerResumeLink')).toBe('Download resume');
    expect(t('ru', 'footerResumeLink')).toBe('Скачать резюме');
  });
});

describe('localizedFragmentFile', () => {
  test('leaves the default language untouched', () => {
    expect(localizedFragmentFile('resume.html', DEFAULT_LANG)).toBe('resume.html');
  });

  test('inserts the language before the extension', () => {
    expect(localizedFragmentFile('resume.html', 'ru')).toBe('resume.ru.html');
  });

  test('appends when there is no extension', () => {
    expect(localizedFragmentFile('resume', 'ru')).toBe('resume.ru');
  });
});
