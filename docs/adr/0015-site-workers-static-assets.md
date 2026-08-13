# ADR-0015: Static marketing site on Cloudflare Workers static assets

## Context

The public site needs to be fast, static, SEO-friendly and deployed
to `openvideomaker.heartboat.me`. Cloudflare Pages project creation
was rejected by this account's API; Wrangler 4 recommends Workers
static assets for all new projects.

## Decision

- `apps/site` is an Astro static build (3 pages, real Studio
  screenshots, honest status copy - no fake completeness).
- Deployed as a Workers static-assets project: a tiny Worker serves
  the Astro `dist/` through the `ASSETS` binding with directory
  indexes and a 404 fallback; `wrangler.jsonc` pins the custom
  domain route `openvideomaker.heartboat.me`.
- Root scripts: `site:dev`, `site:build`, `site:check` (visual +
  dead-link check), `site:deploy`.

## Consequences

- One repository owns the site; deploys are one command.
- No server-side rendering: the site stays static until a real
  feature needs it.
- Screenshots in the site are real product captures (replaced with
  the app, not mock marketing images).

## Alternatives considered

- Cloudflare Pages: rejected in practice - project creation failed
  with an account API error (code 8000000).
- Vite-only static site: rejected - Astro gives routing, layouts
  and SEO ergonomics for near-zero cost.
