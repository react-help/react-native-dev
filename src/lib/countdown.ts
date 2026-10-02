// Shared by the build-time render and the client script so both print the same words.

const DAY = 86_400_000;

export function daysUntil(isoDate: string, now = new Date()): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((Date.parse(`${isoDate}T00:00:00Z`) - today) / DAY);
}

export function countdownText(days: number): string {
  if (days > 1) return `${days} days left`;
  if (days === 1) return '1 day left';
  if (days === 0) return 'Today';
  return 'In effect';
}
