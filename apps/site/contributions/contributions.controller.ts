import { Injectable } from '@bg/core';
import { errorResponse } from '../http/requests';
import { type Lang, resolveLang, t } from '../i18n';
import { type Contribution, type ContributionStatus, type ContributionsCache, formatContributionsSummary } from './contributions';

const STATUS_CLASS: Record<ContributionStatus, string> = {
  merged: 'status-merged',
  open: 'status-open',
};

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function renderRow(item: Contribution, lang: Lang) {
  const label = t(lang, item.status === 'merged' ? 'statusMerged' : 'statusOpen');
  return `<li><a class="log-row" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer"><time datetime="${escapeHtml(item.date)}">${escapeHtml(item.date.slice(0, 10))}</time><span class="status ${STATUS_CLASS[item.status]}">${escapeHtml(label)}</span><span class="repo">${escapeHtml(item.repo)}</span><span class="pr-title">${escapeHtml(item.title)}</span><span class="link-arrow" aria-hidden="true">↗</span></a></li>`;
}

function renderContributionsFragment(items: Contribution[], lang: Lang) {
  if (items.length === 0) {
    return `<p class="contributions-empty" role="status">${escapeHtml(t(lang, 'contributionsEmpty'))}</p>`;
  }

  const summary = escapeHtml(formatContributionsSummary(items, lang));

  return `<div class="log"><div class="log-command"><code><span>$</span> gh search prs --author=begenchgeldyev</code><span>${summary}</span></div><ol class="log-list">${items.map((item) => renderRow(item, lang)).join('')}</ol></div>`;
}

@Injectable()
export class ContributionsController {
  constructor(private readonly cache: ContributionsCache) {}

  async get(req: Request) {
    const lang = resolveLang(req);

    try {
      const items = await this.cache.get();
      if (req.headers.get('HX-Request') === 'true') {
        return new Response(renderContributionsFragment(items, lang), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      return Response.json({ contributions: items });
    } catch {
      return errorResponse(502, 'contributions unavailable');
    }
  }
}
