---
status: accepted
date: 2026-11-20
source: apps/site/contributions/, apps/site/components/projects/contributions.html, apps/site/pages/projects.html
---

# Contributions are read live from the GitHub search API and cached in memory

The Projects page shows the owner's recent pull requests to other people's repositories, open and merged. Each visitor request is answered from a 30-minute in-memory cache; a miss queries `GET https://api.github.com/search/issues` with `author:<user> is:pr -user:<user>` and normalizes the hits onto `{ repo, title, url, number, date, status }`, newest first. Status is `merged` when the search result reports a merge date and otherwise `open`; closed pull requests that were never merged are excluded, because a contribution is work someone accepted or is still considering. The merge date of a merged pull request and the creation date of an open one both land in `date`, so one list sorts across both. The header summarises totals — how many pull requests over how many repositories — and each row shows its own status. A failed refresh serves the previously cached list and resets its timestamp, so a broken or rate-limited GitHub throttles retries instead of flooding them; the page retries once on its own before it offers the button, and only a cold failure surfaces as 502 `contributions unavailable`. Nothing is stored in Postgres: GitHub owns the data, and a local copy would be a second source of truth to reconcile.

A build-time snapshot was rejected: it goes stale between deploys, which is the opposite of what a contribution list is meant to show. A stored table was rejected too: it would need a sync job, its own schema and its own staleness policy for data that is one HTTP request away.

`GITHUB_TOKEN` is optional and only raises the rate limit of an unauthenticated search. When set, it must be a token with public access only — the endpoint serves without a session and the fragment is public HTML, so a token that can see private repositories would publish private pull requests on the site.
