export type Lang = 'en' | 'ru';

export const LANGS = ['en', 'ru'] as const;
export const DEFAULT_LANG: Lang = 'en';

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

export function resolveLang(req: Request): Lang {
  const cookieHeader = req.headers.get('cookie') ?? '';
  const match = cookieHeader.match(/(?:^|;\s*)lang=([^;]+)/);
  if (!match) return DEFAULT_LANG;

  let value: string;
  try {
    value = decodeURIComponent(match[1]);
  } catch {
    return DEFAULT_LANG;
  }

  return isLang(value) ? value : DEFAULT_LANG;
}

const EN = {
  navProjects: 'Projects',
  navLogs: 'Logs',
  navCv: 'CV',
  footerCvLink: 'CV.pdf',
  visibilityHidden: 'Hidden',
  visibilityPublished: 'Published',
  projectNoDescription: 'No short description provided.',
  viewProject: 'View project',
  dateUnknown: 'Unknown',
  dateLocale: 'en',
  langToggleLabel: 'Switch language',
} as const;

export type StringKey = keyof typeof EN;

const STRINGS: Record<Lang, Record<StringKey, string>> = {
  en: EN,
  ru: {
    navProjects: 'Проекты',
    navLogs: 'Логи',
    navCv: 'Резюме',
    footerCvLink: 'CV.pdf',
    visibilityHidden: 'Скрыт',
    visibilityPublished: 'Опубликован',
    projectNoDescription: 'Краткое описание не указано.',
    viewProject: 'Открыть проект',
    dateUnknown: 'Неизвестно',
    dateLocale: 'ru',
    langToggleLabel: 'Сменить язык',
  },
};

export function t(lang: Lang, key: StringKey): string {
  return STRINGS[lang][key];
}

export function localizedFragmentFile(fragmentFile: string, lang: Lang): string {
  if (lang === DEFAULT_LANG) return fragmentFile;

  const dot = fragmentFile.lastIndexOf('.');
  if (dot === -1) return `${fragmentFile}.${lang}`;

  return `${fragmentFile.slice(0, dot)}.${lang}${fragmentFile.slice(dot)}`;
}
