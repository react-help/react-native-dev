import type { APIRoute } from 'astro';
import { loadMatrix } from '../lib/load.ts';
import { DOCS_URL, REPO_URL, SITE_URL } from '../lib/site.ts';

// Public, CORS-enabled (see netlify.toml). Shape: one merged row per React Native minor, newest first.
export const GET: APIRoute = () => {
  const matrix = loadMatrix();
  const body = {
    $comment: 'Independent project, not affiliated with the React Foundation. Every value carries a source URL.',
    site: SITE_URL,
    docs: DOCS_URL,
    repository: REPO_URL,
    license: 'MIT',
    ...matrix,
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
