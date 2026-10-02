// Builds feed items from the merged matrix: one per new minor, one per support-status change.

import type { Matrix } from './merge.ts';
import type { SupportStatus } from './types.ts';

export interface FeedItem {
  guid: string;
  title: string;
  link: string;
  date: string;
  description: string;
}

const STATUS_WORDS: Record<SupportStatus, string> = {
  future: 'upcoming',
  active: 'supported',
  'end-of-cycle': 'end of cycle',
  unsupported: 'end of life (unsupported)',
};

export function feedItems(matrix: Matrix, siteUrl: string, limit = 50): FeedItem[] {
  const items: FeedItem[] = [];
  for (const row of matrix.rows) {
    const anchor = `${siteUrl}#v${row.minor}`;
    items.push({
      guid: `rn-${row.minor}-released`,
      title: `React Native ${row.minor} released`,
      link: row.blog ?? row.releaseNotes,
      date: row.released,
      description: `React Native ${row.minor}.0 was published on ${row.released}. Latest patch: ${row.latest}. Compatibility: ${anchor}`,
    });
    // The first history entry is the release itself; later entries are status changes.
    for (const change of row.statusHistory.slice(1)) {
      items.push({
        guid: `rn-${row.minor}-${change.status}`,
        title: `React Native ${row.minor} is now ${STATUS_WORDS[change.status]}`,
        link: anchor,
        date: change.since,
        description:
          `React Native ${row.minor} moved to "${STATUS_WORDS[change.status]}" on ${change.since}.` +
          (change.estimated ? ' (Date estimated from the current support policy.)' : '') +
          ` Source: ${row.statusSource}`,
      });
    }
  }
  return items.sort((a, b) => b.date.localeCompare(a.date) || a.guid.localeCompare(b.guid)).slice(0, limit);
}
