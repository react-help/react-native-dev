// Small version helpers shared by the fetch script, the merge step and the client lookup.

export const isStable = (v: string) => /^\d+\.\d+\.\d+$/.test(v);

/** "0.81.4" -> "0.81" */
export const minorOf = (v: string) => v.split('.').slice(0, 2).join('.');

/** "0.81" -> 81 (React Native is still on major 0). */
export const minorNum = (m: string) => Number(m.split('.')[1]);

export const patchNum = (v: string) => Number(v.split('.')[2] ?? 0);

export function compareMinor(a: string, b: string): number {
  const [aMaj, aMin] = a.split('.').map(Number);
  const [bMaj, bMin] = b.split('.').map(Number);
  return aMaj! - bMaj! || aMin! - bMin!;
}

/**
 * Normalise free-form input ("81", "0.81", "v0.81.4", "react-native@0.81") to a minor key.
 * Returns null when nothing version-like is found.
 */
export function parseMinorInput(input: string): string | null {
  const m = input.trim().match(/(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  if (m[2] === undefined) return `0.${Number(m[1])}`;
  return `${Number(m[1])}.${Number(m[2])}`;
}

/** Compare dotted numeric versions of any length: "16.1" vs "26.0" vs "14.3.1". */
export function compareDotted(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
