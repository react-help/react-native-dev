import type { APIRoute } from 'astro';
import { loadMatrix } from '../lib/load.ts';
import { feedItems } from '../lib/feed.ts';
import { SITE_URL, TITLE } from '../lib/site.ts';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rfc822 = (isoDate: string) => new Date(`${isoDate}T12:00:00Z`).toUTCString();

export const GET: APIRoute = () => {
  const matrix = loadMatrix();
  const items = feedItems(matrix, SITE_URL);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(TITLE)}</title>
    <link>${SITE_URL}</link>
    <atom:link href="${SITE_URL}feed.xml" rel="self" type="application/rss+xml"/>
    <description>New React Native minors and support-status changes. Independent project, not affiliated with the React Foundation.</description>
    <language>en</language>
    <lastBuildDate>${new Date(matrix.generatedAt).toUTCString()}</lastBuildDate>
${items
  .map(
    (i) => `    <item>
      <title>${esc(i.title)}</title>
      <link>${esc(i.link)}</link>
      <guid isPermaLink="false">${esc(i.guid)}</guid>
      <pubDate>${rfc822(i.date)}</pubDate>
      <description>${esc(i.description)}</description>
    </item>`,
  )
  .join('\n')}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
};
